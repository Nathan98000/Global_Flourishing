## Model card: binary outcomes

The adjusted association the Correlates view shows for a yes/no item or a derived screener (PHQ-2, GAD-2 positive).

**Model family.** Survey-weighted logistic regression, fitted by iteratively reweighted least squares to the complete cases. In R: `svyglm(outcome ~ predictor + controls, design, family = quasibinomial())`.

**Specification.** For respondent *i*, `log( p_i / (1 − p_i) ) = α + β·predictor_i + Σ γ_k·control_ik`, where `p_i` is the probability of the event and each respondent is weighted by the wave's survey weight. The event is code 1 — "Yes" for a catalog item, "screen positive" for a derived screener. One model per country (the ranked list), or one model over every country with country fixed effects (the cross-country matrix). The predictor enters as a number on its own scale; a yes/no predictor enters as a 0/1 indicator of "Yes".

**Control set.** Age band, gender, education (three levels), employment status and marital status, each dummy-coded with its first level dropped, plus country fixed effects whenever more than one country shares the frame. The set is the same for every outcome and every predictor. Grouping by country removes the country effect; a control that never varies in a group drops out.

**Weight and eligibility.** The wave's cross-sectional weight, looked up in the wave → weight → eligibility table (`w_c1` at Wave 1, `w_c2` at Wave 2, `w_l1m` at the midyear survey); the respondents eligible for that weight are the design.

**Standard error.** The design-based sandwich estimator on the score residuals `w_i (y_i − p̂_i) x_i`, Taylor-linearised over strata and primary sampling units — R `svyglm`'s number. Intervals are 95% normal intervals on the log-odds scale. The fit stops on R's rule (a relative change in the deviance below 10⁻¹¹), so a control level with no events converges as it does in R.

**What the coefficient means.** β is the change in the log-odds of the event associated with a one-unit change in the predictor, among people alike on every control; `exp(β)` is the corresponding odds ratio. The view charts β per one standard deviation of the predictor (an exact rescaling with the same interval) so measures with different scales can be compared; the data table carries both quantities. A positive coefficient means the event is more likely as the predictor rises.

**Limitations.**

- No causal claim. The controls narrow, but do not close, the gap between "goes with" and "leads to"; residual confounding remains.
- Cross-sectional: one interview, no order in time.
- Country fixed effects absorb every between-country difference: the pooled coefficient is a within-country association.
- Log-odds are not probabilities: the same β moves a rare event's probability much less than a common one's.
- A group whose event never (or always) happens has no finite coefficient and is shown as undefined, with its n.
- Complete cases only; the ranked list is not a test.
