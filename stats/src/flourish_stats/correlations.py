"""Weighted correlations and adjusted associations (proposal §5.3).

Two flavours of "what travels with X":

- :func:`weighted_correlation` — the unadjusted, point-estimate-only
  Pearson/Spearman coefficient (``ci_method = "none"``: no interval is
  claimed, so none is drawn).
- :func:`adjusted_association` — the predictor's coefficient in a
  survey-weighted regression of the outcome on the predictor and a fixed
  control set (WLS for continuous outcomes, logistic IRLS for binary
  ones), with the design-based sandwich SE that R's ``svyglm`` reports
  (ADR-0014).
"""

# polars' expression API ships partially-unknown signatures, so this one
# strict diagnostic is disabled for this module; every other check applies.
# pyright: reportUnknownMemberType=false

from __future__ import annotations

from collections.abc import Sequence
from typing import Literal, cast

import numpy as np
import polars as pl
import pyarrow as pa
from numpy.typing import NDArray

from ._core import (
    Frame,
    check_columns,
    finalize,
    group_keys,
    taylor_variance,
    to_polars,
    with_dummy,
)
from .design import Design
from .suppression import DEFAULT_POLICY, SuppressionPolicy

Method = Literal["pearson", "spearman"]
Family = Literal["gaussian", "binomial"]
Vector = NDArray[np.float64]
Matrix = NDArray[np.float64]

#: The fixed control set of the adjusted models (proposal §5.3): every
#: entry is categorical and enters dummy-coded with its first level
#: dropped; ``country_code`` is the country fixed effect.
DEFAULT_CONTROLS: tuple[str, ...] = (
    "age_band",
    "gender",
    "education_3",
    "employment",
    "marital_status",
    "country_code",
)

#: The two rows every adjusted-association group emits: the raw
#: coefficient, and the same coefficient per one weighted SD of the
#: predictor (the fit on ``x / sd(x)`` — a rescaling of ``x`` rescales the
#: coefficient and its SE by exactly the same constant, so the second row
#: costs nothing and needs no approximation).
MEASURES: tuple[str, ...] = ("beta", "beta_per_sd")

#: IRLS stopping rule for the logistic fit — R's glm rule, a relative
#: change in the deviance below the tolerance, so that a control level
#: with no events (whose dummy coefficient walks off to −∞ while the
#: deviance settles) still converges exactly as it does in R.
_IRLS_MAX_ITER = 100
_IRLS_EPS = 1e-11
#: Fitted probabilities are kept this far from 0 and 1 so the working
#: weights stay finite (R clips the linear predictor at ±36 to the same
#: end); the clip is what lets a separated level's deviance settle.
_MU_EPS = 1e-10


def weighted_correlation(
    frame: Frame,
    x: str,
    y: str,
    design: Design,
    *,
    method: Method = "pearson",
    by: Sequence[str] = (),
    policy: SuppressionPolicy = DEFAULT_POLICY,
) -> pa.Table:
    """Weighted correlation of two items on their complete cases.

    Pearson is the weighted covariance over the weighted variances — the
    common denominator cancels, so it equals the ratio built from R
    ``svyvar(~x + y)``. Spearman average-ranks the *unweighted* values
    (ties averaged) within each group and takes the weighted Pearson of the
    ranks; that is one of several defensible definitions of a weighted
    Spearman (documented in METHODS.md), chosen because it reduces to the
    classical coefficient under equal weights.

    Undefined correlations (zero weighted variance in either item) return a
    null estimate with their ``n`` intact.
    """
    if method not in ("pearson", "spearman"):
        raise ValueError(f"method must be 'pearson' or 'spearman', got {method!r}")
    df = to_polars(frame)
    check_columns(df, design, x, by)
    check_columns(df, design, y, by)
    df = with_dummy(df, by)
    groups = group_keys(by)
    w = pl.col(design.weight)

    valid = df.filter(pl.col(x).is_not_null() & pl.col(y).is_not_null())
    if method == "spearman":
        valid = valid.with_columns(
            pl.col(x).rank(method="average").over(groups).cast(pl.Float64).alias("_vx"),
            pl.col(y).rank(method="average").over(groups).cast(pl.Float64).alias("_vy"),
        )
    else:
        valid = valid.with_columns(
            pl.col(x).cast(pl.Float64).alias("_vx"), pl.col(y).cast(pl.Float64).alias("_vy")
        )

    means = valid.group_by(groups).agg(
        ((w * pl.col("_vx")).sum() / w.sum()).alias("_mx"),
        ((w * pl.col("_vy")).sum() / w.sum()).alias("_my"),
    )
    moments = (
        valid.join(means, on=groups, how="inner")
        .with_columns(
            (pl.col("_vx") - pl.col("_mx")).alias("_dx"),
            (pl.col("_vy") - pl.col("_my")).alias("_dy"),
        )
        .group_by(groups)
        .agg(
            (w * pl.col("_dx") * pl.col("_dy")).sum().alias("_sxy"),
            (w * pl.col("_dx").pow(2)).sum().alias("_sxx"),
            (w * pl.col("_dy").pow(2)).sum().alias("_syy"),
            pl.len().cast(pl.Int64).alias("n"),
            w.sum().alias("sum_w"),
        )
    )
    records = moments.with_columns(
        pl.when((pl.col("_sxx") > 0) & (pl.col("_syy") > 0))
        .then(pl.col("_sxy") / (pl.col("_sxx") * pl.col("_syy")).sqrt())
        .otherwise(None)
        .alias("estimate"),
        pl.lit(None, dtype=pl.Float64).alias("se"),
        pl.lit(None, dtype=pl.Int64).alias("n_psu"),
        pl.lit(None, dtype=pl.Int64).alias("n_strata"),
        pl.lit(None, dtype=pl.Int64).alias("df"),
    )
    return finalize(
        records,
        df.select(groups).unique(),
        stat=f"{method}_r",
        design=design,
        groups=groups,
        by=by,
        ci_level=0.95,
        ci_method="none",
        policy=policy,
    )


def adjusted_association(
    frame: Frame,
    outcome: str,
    predictor: str,
    design: Design,
    *,
    family: Family = "gaussian",
    controls: Sequence[str] = DEFAULT_CONTROLS,
    by: Sequence[str] = (),
    policy: SuppressionPolicy = DEFAULT_POLICY,
) -> pa.Table:
    """Adjusted association: the predictor's coefficient under the control set.

    A survey-weighted regression of ``outcome`` on ``predictor`` and the
    dummy-coded ``controls`` (first level dropped), fitted on the complete
    cases of each ``by`` group:

    - ``family="gaussian"`` — weighted least squares; the coefficient is
      the change in the outcome per unit of the predictor, holding the
      controls fixed.
    - ``family="binomial"`` — weighted logistic regression by IRLS on a 0/1
      outcome; the coefficient is the change in the log-odds per unit.

    The family is the caller's choice from the catalog's ``scale_type``
    (``binary`` → binomial), never inferred from the values.

    **Standard errors** are R ``svyglm``'s: the sandwich estimator whose
    meat is the Taylor-linearised variance of the score residuals over
    strata/PSU (the same machinery as every other estimator here, applied
    to the coefficient's influence values ``(XᵀWX)⁻¹ x_i w_i (y_i − μ_i)``).
    A design without strata/PSU falls back to the Kish path — a
    model-based variance on the effective sample size, which for an
    intercept-only model is exactly the mean estimator's Kish SE — and
    ``se_method`` reports it.

    **Fixed effects and ``by``:** a control that is also a grouping column
    is constant within every group and would be collinear with the
    intercept, so it is dropped from the controls for that call. In
    particular, grouping by ``country_code`` drops the country fixed
    effect: a per-country model carries no country dummies.

    **Undefined fits never raise.** A group whose design matrix is
    rank-deficient (a constant predictor, an aliased dummy, too few
    complete cases for the parameters), whose binary outcome never varies,
    or whose IRLS does not converge returns a null ``estimate``/``se`` with
    its ``n`` intact — mirroring :func:`weighted_correlation`'s undefined
    case.

    Two rows per group (``measure``): ``beta`` and ``beta_per_sd``, the
    coefficient per one weighted SD of the predictor (comparable across
    predictors with different scales).
    """
    if family not in ("gaussian", "binomial"):
        raise ValueError(f"family must be 'gaussian' or 'binomial', got {family!r}")
    df = to_polars(frame)
    check_columns(df, design, outcome, by)
    check_columns(df, design, predictor, by)
    missing = [c for c in controls if c not in df.columns]
    if missing:
        raise ValueError(f"frame is missing control columns {missing}")
    if predictor == outcome:
        raise ValueError("predictor and outcome must be different columns")
    # The fixed-effect rule: a control that is also a grouping column is
    # constant within each group — it cannot also be a regressor.
    used_controls = tuple(dict.fromkeys(c for c in controls if c not in by))
    if predictor in used_controls:
        raise ValueError(f"predictor {predictor!r} is also a control")
    df = with_dummy(df, by)
    groups = group_keys(by)

    complete = pl.all_horizontal(
        [pl.col(c).is_not_null() for c in (outcome, predictor, *used_controls)]
    )
    valid = df.filter(complete)
    if family == "binomial":
        observed = set(valid[outcome].unique().to_list())
        if not observed <= {0, 1}:
            raise ValueError(
                f"family='binomial' needs a 0/1 outcome; {outcome!r} takes {sorted(observed)[:5]}"
            )
    if design.se_method == "taylor":
        strata, psu = design.strata, design.psu
        assert strata is not None and psu is not None
        design_counts = df.group_by(strata).agg(
            pl.col(psu).n_unique().cast(pl.Int64).alias("_n_psu_design")
        )
        valid = valid.join(design_counts, on=strata, how="inner")

    fits: list[pl.DataFrame] = []
    scored: list[pl.DataFrame] = []
    for sub in valid.partition_by(groups, maintain_order=True):
        fit = _fit_group(sub, outcome, predictor, used_controls, design, family)
        keys = sub.select(groups).head(1)
        fits.append(keys.with_columns(**{k: pl.lit(v) for k, v in fit.record.items()}))
        if fit.influence is not None:
            scored.append(
                sub.select([*groups, *design.columns, "_n_psu_design"]).with_columns(
                    pl.Series("_z", fit.influence)
                )
            )

    if fits:
        records = pl.concat(fits, how="vertical_relaxed")
    else:
        records = valid.select(groups).with_columns(
            pl.lit(None, dtype=pl.Float64).alias("_beta"),
            pl.lit(None, dtype=pl.Float64).alias("_se"),
            pl.lit(None, dtype=pl.Float64).alias("_sd_x"),
            pl.lit(0, dtype=pl.Int64).alias("n"),
            pl.lit(0.0).alias("sum_w"),
        )
    if design.se_method == "taylor" and scored:
        variance = taylor_variance(pl.concat(scored), groups, design, "_z")
        records = records.join(variance, on=groups, how="left").with_columns(
            pl.col("_var").sqrt().alias("_se"),
            (pl.col("_n_psu") - pl.col("_n_strata")).alias("df"),
        )
    else:
        records = records.with_columns(
            pl.lit(None, dtype=pl.Int64).alias("_n_psu"),
            pl.lit(None, dtype=pl.Int64).alias("_n_strata"),
            pl.lit(None, dtype=pl.Int64).alias("df"),
        )
    records = records.with_columns(
        pl.when(pl.col("_beta").is_null()).then(None).otherwise(pl.col("_se")).alias("_se")
    )
    measures = pl.DataFrame({"measure": list(MEASURES)})
    records = (
        records.join(measures, how="cross")
        .with_columns(
            pl.when(pl.col("measure") == "beta_per_sd")
            .then(pl.col("_beta") * pl.col("_sd_x"))
            .otherwise(pl.col("_beta"))
            .alias("estimate"),
            pl.when(pl.col("measure") == "beta_per_sd")
            .then(pl.col("_se") * pl.col("_sd_x"))
            .otherwise(pl.col("_se"))
            .alias("se"),
        )
        .rename({"_n_psu": "n_psu", "_n_strata": "n_strata"})
        .select([*groups, "measure", "estimate", "se", "n", "sum_w", "n_psu", "n_strata", "df"])
    )
    universe = df.select(groups).unique().join(measures, how="cross")
    return finalize(
        records,
        universe,
        stat="beta",
        design=design,
        groups=groups,
        by=by,
        extra=["measure"],
        ci_level=0.95,
        ci_method="normal",
        policy=policy,
    )


class _GroupFit:
    """One group's fit: the record fields and, for Taylor, the per-row
    influence values of the predictor's coefficient (None when undefined)."""

    __slots__ = ("influence", "record")

    def __init__(self, record: dict[str, object], influence: Vector | None) -> None:
        self.record = record
        self.influence = influence


def _design_matrix(sub: pl.DataFrame, predictor: str, controls: Sequence[str]) -> Matrix:
    """Intercept, the predictor, then each control's dummies (first level
    dropped; levels are the group's observed values in sorted order)."""
    n = sub.height
    columns: list[Matrix] = [np.ones(n), sub[predictor].cast(pl.Float64).to_numpy()]
    for control in controls:
        codes = sub.select(pl.col(control).rank("dense").cast(pl.Int64)).to_series().to_numpy()
        n_levels = int(codes.max())
        if n_levels > 1:
            columns.append(np.eye(n_levels)[codes - 1][:, 1:])
    return np.column_stack(columns)


def _fit_group(
    sub: pl.DataFrame,
    outcome: str,
    predictor: str,
    controls: Sequence[str],
    design: Design,
    family: Family,
) -> _GroupFit:
    y = sub[outcome].cast(pl.Float64).to_numpy()
    w = sub[design.weight].cast(pl.Float64).to_numpy()
    x = sub[predictor].cast(pl.Float64).to_numpy()
    n = int(sub.height)
    sum_w = float(w.sum())
    x_mean = float((w * x).sum() / sum_w)
    sd_x = float(np.sqrt((w * (x - x_mean) ** 2).sum() / sum_w))
    record: dict[str, object] = {
        "_beta": None,
        "_se": None,
        "_sd_x": sd_x,
        "n": n,
        "sum_w": sum_w,
    }
    undefined = _GroupFit(record, None)

    xmat = _design_matrix(sub, predictor, controls)
    k = xmat.shape[1]
    if n <= k:
        return undefined
    solved = _solve(xmat, y, w, family)
    if solved is None:
        return undefined
    beta, mu, v = solved
    # info = XᵀWX with the working weights w·v; a = info⁻¹ e_pred (the
    # matrix is symmetric, so this is the predictor's row of the inverse).
    info: Matrix = np.asarray((xmat * (w * v)[:, None]).T @ xmat, dtype=np.float64)
    unit = np.eye(k)[1]
    try:
        a = cast(Vector, np.linalg.solve(info, unit))
    except np.linalg.LinAlgError:  # pragma: no cover - rank was checked in _solve
        return undefined
    residual = w * (y - mu)
    influence = np.asarray(residual * (xmat @ a), dtype=np.float64)
    record["_beta"] = float(beta[1])
    if design.se_method == "taylor":
        return _GroupFit(record, influence)
    # Kish fallback: the model-based variance on the effective sample size
    # (weights rescaled to sum to n_eff; gaussian dispersion on n_eff − k
    # degrees of freedom, binomial dispersion 1).
    n_eff = sum_w * sum_w / float((w * w).sum())
    if family == "gaussian":
        if n_eff <= k:
            return undefined
        dispersion = float((w * (y - mu) ** 2).sum()) / (n_eff - k)
        record["_se"] = float(np.sqrt(dispersion * a[1]))
    else:
        record["_se"] = float(np.sqrt(sum_w / n_eff * a[1]))
    return _GroupFit(record, None)


def _solve(
    xmat: Matrix, y: Vector, w: Vector, family: Family
) -> tuple[Vector, Vector, Vector] | None:
    """Coefficients, fitted means and variance function of one fit, or
    None when the fit is undefined (rank deficiency, a constant binary
    outcome, non-convergence)."""
    k = xmat.shape[1]
    sqrt_w = np.sqrt(w)
    if family == "gaussian":
        beta, _, rank, _ = np.linalg.lstsq(xmat * sqrt_w[:, None], y * sqrt_w, rcond=None)
        if rank < k:
            return None
        return beta, xmat @ beta, np.ones_like(y)

    p_bar = float((w * y).sum() / w.sum())
    if p_bar <= 0.0 or p_bar >= 1.0:
        return None  # the outcome never varies: no finite log-odds
    beta = np.zeros(k)
    beta[0] = np.log(p_bar / (1.0 - p_bar))
    deviance_old = np.inf
    for _ in range(_IRLS_MAX_ITER):
        eta = xmat @ beta
        mu = _expit(eta)
        v = mu * (1.0 - mu)
        working = eta + (y - mu) / v
        sqrt_ww = np.sqrt(w * v)
        step, _, rank, _ = np.linalg.lstsq(xmat * sqrt_ww[:, None], working * sqrt_ww, rcond=None)
        if rank < k or not np.all(np.isfinite(step)):
            return None
        mu_new = _expit(xmat @ step)
        deviance = -2.0 * float((w * (y * np.log(mu_new) + (1.0 - y) * np.log(1.0 - mu_new))).sum())
        beta = step
        if abs(deviance - deviance_old) / (abs(deviance) + 0.1) < _IRLS_EPS:
            return beta, mu_new, mu_new * (1.0 - mu_new)
        deviance_old = deviance
    return None


def _expit(eta: Vector) -> Vector:
    return np.clip(1.0 / (1.0 + np.exp(-eta)), _MU_EPS, 1.0 - _MU_EPS)
