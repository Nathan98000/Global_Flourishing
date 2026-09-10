#!/usr/bin/env Rscript
# Compute the 30 reference estimates for the flourish_stats parity check.
#
# Reads  stats/verify/cases.csv           (case definitions)
#        data/intermediate/verify_extract.csv   (built by extract.py)
#        data/intermediate/verify_extract.meta  (sha256, data_version)
# Writes stats/verify/reference.json      (committed; aggregates only)
#
# The only package dependency is `survey` (>= 4.2, for the rewritten
# svyquantile and its qrule="math"). JSON is emitted with sprintf to keep
# it that way. Run from the repo root:  Rscript stats/verify/reference.R

.libPaths(c(path.expand(Sys.getenv("R_LIBS_USER")), .libPaths()))
suppressMessages(library(survey))
if (packageVersion("survey") < "4.2") {
  stop(sprintf(
    "survey >= 4.2 required (svyquantile qrule='math'); found %s",
    packageVersion("survey")
  ))
}
options(survey.lonely.psu = "adjust", survey.adjust.domain.lonely = TRUE)

repo_root <- normalizePath(file.path(dirname(sub(
  "--file=", "",
  grep("--file=", commandArgs(FALSE), value = TRUE)
)), "..", ".."))
verify_dir <- file.path(repo_root, "stats", "verify")
extract_csv <- file.path(repo_root, "data", "intermediate", "verify_extract.csv")
extract_meta <- file.path(repo_root, "data", "intermediate", "verify_extract.meta")
out_json <- file.path(verify_dir, "reference.json")

if (!file.exists(extract_csv)) {
  stop(sprintf("missing %s - run `uv run python stats/verify/extract.py` first", extract_csv))
}
extract <- read.csv(extract_csv, na.strings = "NA")
cases <- read.csv(file.path(verify_dir, "cases.csv"), na.strings = c("", "NA"))
meta_lines <- strsplit(readLines(extract_meta), "=", fixed = TRUE)
meta <- setNames(
  vapply(meta_lines, function(kv) kv[[2]], ""),
  vapply(meta_lines, function(kv) kv[[1]], "")
)

# --- eligibility per weight-table key (mirrors flourish_stats.weights) ---
eligible_rows <- function(d, filter) {
  switch(filter,
    y1 = d,
    y2 = d[d$retained_y2 == 1, ],
    my = d[d$has_midyear == 1, ],
    y1_y2 = d[d$retained_y2 == 1, ],
    my_y2 = d[
      d$retained_y2 == 1 & d$has_midyear == 1 & !is.na(d$midyear_type) & d$midyear_type == 1,
    ],
    stop("unknown filter: ", filter)
  )
}

make_design <- function(d, weight) {
  svydesign(
    ids = ~psu, strata = ~strata,
    weights = as.formula(paste0("~", weight)),
    data = d, nest = TRUE
  )
}

# --- tiny JSON emitters (survey is the only dependency, so no jsonlite) ---
jnum <- function(x) if (is.na(x)) "null" else sprintf("%.17g", x)
jint <- function(x) sprintf("%d", as.integer(x))
jstr <- function(x) if (is.na(x)) "null" else sprintf('"%s"', gsub('"', '\\\\"', x))
jlevel <- function(x) if (is.character(x)) jstr(x) else jnum(x)
jobj <- function(...) paste0("{", paste(..., sep = ", "), "}")
jarr <- function(items) paste0("[", paste(items, collapse = ", "), "]")
jfield <- function(name, value) sprintf('"%s": %s', name, value)

point_expect <- function(est, se, n) {
  jobj(jfield("estimate", jnum(est)), jfield("se", jnum(se)), jfield("n", jint(n)))
}
level_expect <- function(level, est, se, n) {
  jobj(
    jfield("level", jlevel(level)), jfield("estimate", jnum(est)),
    jfield("se", jnum(se)), jfield("n", jint(n))
  )
}

run_case <- function(case) {
  d <- eligible_rows(extract[extract$country_code == case$country, ], case$filter)
  if (case$stat == "mean" && is.na(case$by)) {
    des <- make_design(d, case$weight)
    m <- suppressWarnings(svymean(make.formula(case$var1), des, na.rm = TRUE))
    return(point_expect(coef(m)[[1]], SE(m)[[1]], sum(!is.na(d[[case$var1]]))))
  }
  if (case$stat == "mean") { # domain estimation by a demographic
    des <- make_design(d, case$weight)
    by_column <- d[[case$by]]
    by_values <- sort(unique(by_column[!is.na(by_column)]))
    items <- vapply(by_values, function(level) {
      keep <- !is.na(by_column) & by_column == level
      sub <- suppressWarnings(des[keep, ])
      m <- suppressWarnings(svymean(make.formula(case$var1), sub, na.rm = TRUE))
      n <- sum(!is.na(d[[case$var1]]) & keep)
      level_expect(level, coef(m)[[1]], SE(m)[[1]], n)
    }, "")
    return(jobj(jfield("levels", jarr(items))))
  }
  if (case$stat == "proportion") {
    des <- make_design(d, case$weight)
    values <- d[[case$var1]]
    lv <- sort(unique(values[!is.na(values)]))
    items <- vapply(lv, function(level) {
      m <- suppressWarnings(svymean(
        as.formula(sprintf("~as.numeric(%s == %s)", case$var1, level)), des, na.rm = TRUE
      ))
      level_expect(level, coef(m)[[1]], SE(m)[[1]], sum(!is.na(values) & values == level))
    }, "")
    return(jobj(jfield("levels", jarr(items))))
  }
  if (case$stat == "quantile") {
    des <- make_design(d, case$weight)
    q <- suppressWarnings(svyquantile(
      make.formula(case$var1), des, quantiles = case$p, qrule = "math",
      na.rm = TRUE, ci = FALSE
    ))
    return(jobj(
      jfield("estimate", jnum(as.numeric(q[[1]])[[1]])),
      jfield("n", jint(sum(!is.na(d[[case$var1]]))))
    ))
  }
  if (case$stat == "change") {
    d$chg <- d[[case$var2]] - d[[case$var1]]
    des <- make_design(d, case$weight)
    m <- suppressWarnings(svymean(~chg, des, na.rm = TRUE))
    return(point_expect(coef(m)[[1]], SE(m)[[1]], sum(!is.na(d$chg))))
  }
  if (case$stat == "correlation") {
    des <- make_design(d, case$weight)
    vv <- as.matrix(suppressWarnings(svyvar(
      make.formula(c(case$var1, case$var2)), des, na.rm = TRUE
    )))
    r <- vv[1, 2] / sqrt(vv[1, 1] * vv[2, 2])
    n <- sum(!is.na(d[[case$var1]]) & !is.na(d[[case$var2]]))
    return(jobj(jfield("estimate", jnum(r)), jfield("n", jint(n))))
  }
  if (case$stat == "transition") {
    pair_ok <- !is.na(d[[case$var1]]) & !is.na(d[[case$var2]])
    d$fromv <- ifelse(pair_ok, d[[case$var1]], NA)
    d$tov <- ifelse(pair_ok, d[[case$var2]], NA)
    des <- make_design(d, case$weight)
    lv <- sort(unique(c(d$fromv[!is.na(d$fromv)], d$tov[!is.na(d$tov)])))
    joint <- character(0)
    for (i in lv) {
      for (j in lv) {
        m <- suppressWarnings(svymean(
          as.formula(sprintf("~as.numeric(fromv == %s & tov == %s)", i, j)), des, na.rm = TRUE
        ))
        n_cell <- sum(pair_ok & d[[case$var1]] == i & d[[case$var2]] == j)
        joint <- c(joint, jobj(
          jfield("from", jnum(i)), jfield("to", jnum(j)),
          jfield("estimate", jnum(coef(m)[[1]])), jfield("se", jnum(SE(m)[[1]])),
          jfield("n", jint(n_cell))
        ))
      }
    }
    conditional <- character(0)
    for (i in lv) {
      sub <- suppressWarnings(subset(des, fromv == i))
      for (j in lv) {
        m <- suppressWarnings(svymean(~ as.numeric(tov == j), sub, na.rm = TRUE))
        n_cell <- sum(pair_ok & d[[case$var1]] == i & d[[case$var2]] == j)
        conditional <- c(conditional, jobj(
          jfield("from", jnum(i)), jfield("to", jnum(j)),
          jfield("estimate", jnum(coef(m)[[1]])), jfield("se", jnum(SE(m)[[1]])),
          jfield("n", jint(n_cell))
        ))
      }
    }
    return(jobj(
      jfield("joint", jarr(joint)),
      jfield("conditional", jarr(conditional))
    ))
  }
  stop("unknown stat: ", case$stat)
}

case_json <- character(0)
for (k in seq_len(nrow(cases))) {
  case <- as.list(cases[k, ])
  expect <- run_case(case)
  case_json <- c(case_json, jobj(
    jfield("id", jstr(case$id)),
    jfield("stat", jstr(case$stat)),
    jfield("country", jint(case$country)),
    jfield("filter", jstr(case$filter)),
    jfield("weight", jstr(case$weight)),
    jfield("var1", jstr(case$var1)),
    jfield("var2", if (is.na(case$var2)) "null" else jstr(case$var2)),
    jfield("by", if (is.na(case$by)) "null" else jstr(case$by)),
    jfield("p", jnum(case$p)),
    jfield("expect", expect)
  ))
  cat(sprintf("  %-38s done\n", case$id))
}

meta_json <- jobj(
  jfield("r_version", jstr(sprintf(
    "%s.%s", R.version$major, R.version$minor
  ))),
  jfield("survey_version", jstr(as.character(packageVersion("survey")))),
  jfield("survey_lonely_psu", jstr(getOption("survey.lonely.psu"))),
  jfield("survey_adjust_domain_lonely", tolower(getOption("survey.adjust.domain.lonely"))),
  jfield("extract_sha256", jstr(meta[["sha256"]])),
  jfield("extract_rows", jint(as.integer(meta[["rows"]]))),
  jfield("data_version", jstr(meta[["data_version"]]))
)
writeLines(
  paste0(jobj(jfield("meta", meta_json), jfield("cases", jarr(case_json)))),
  out_json
)
cat(sprintf(
  "wrote %s (%d cases, survey %s)\n",
  out_json, nrow(cases), packageVersion("survey")
))
