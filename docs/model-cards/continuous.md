## Model card: continuous outcomes

The adjusted association the Correlates view shows for a 0–10 scale, a count or an ordinal item.

**Model family.** Survey-weighted least squares: the outcome regressed on one predictor and the fixed control set, fitted to the complete cases by minimising the weighted sum of squared residuals. In R: `svyglm(outcome ~ predictor + controls, design, family = gaussian())`.

**Specification.** For respondent *i*, `outcome_i = α + β·predictor_i + Σ γ_k·control_ik + ε_i`, with each respondent weighted by the wave's survey weight. One model per country (the ranked list), or one model over every country with country fixed effects (the cross-country matrix). The predictor enters as a number on its own scale; a yes/no item enters as a 0/1 indicator of "Yes".

**Control set.** Age band, gender, education (three levels), employment status and marital status, each dummy-coded with its first level dropped, plus country fixed effects whenever more than one country shares the frame. The set is the same for every outcome and every predictor — it is never chosen per pair. Grouping by country removes the country effect (a per-country model cannot also carry it); a control that never varies in a group drops out.

**Weight and eligibility.** The wave's cross-sectional weight, looked up in the wave → weight → eligibility table (`w_c1` at Wave 1, `w_c2` at Wave 2, `w_l1m` at the midyear survey); the respondents eligible for that weight are the design. The API never chooses a weight itself.

**Standard error.** The design-based sandwich estimator: the coefficient's influence values are Taylor-linearised over strata and primary sampling units, exactly as every mean in the app is — R `svyglm` reports the same number. Intervals are 95% normal intervals. Where the design has no strata (never the case in the release) the engine falls back to a Kish effective-sample-size variance and says so.

**What the coefficient means.** β is the change in the outcome, in points of its own scale, associated with a one-unit change in the predictor, among people who are alike on every control. The view charts β per one standard deviation of the predictor (β × SD, an exact rescaling with the same interval) so measures with different scales can be compared; the data table carries both quantities. A positive coefficient means the two rise together; a negative one means one rises as the other falls.

**Limitations.**

- No causal claim. "Controlling for" a handful of demographics is not "accounting for" everything that could make two answers travel together; residual confounding — unmeasured differences between people — remains, and the sentence to say is "associated with".
- Cross-sectional. Both answers come from one interview; the model cannot tell which came first, or whether either would change if the other did.
- Country fixed effects absorb every between-country difference: the pooled coefficient is a within-country association, and says nothing about why countries differ from one another.
- Linear and additive: one slope for the whole range of the predictor, the same slope for every group.
- Complete cases only: a respondent missing the outcome, the predictor or any control leaves the model (but stays in the variance design).
- Two hundred models make a ranked list; the ranking itself is not a test, and the strongest associations are the ones most likely to have been flattered by chance.
