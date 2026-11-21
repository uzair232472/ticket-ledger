"""
Approval gates. Fixed BEFORE any model was evaluated and recorded in every report, so they cannot be
tuned afterwards to let a model through. In production they are admin settings with these defaults.

A model is PASSED only if every gate holds. Otherwise it is REJECTED (reasons listed) or
NOT_ENOUGH_DATA (the test period is too small to judge - the rules stay in charge).
"""

GATES = {
    # Evidence: the improvement over the baseline must hold in a 95% bootstrap interval (resampling
    # whole events), not just on average.
    "bootstrap_resamples": 300,
    "bootstrap_confidence": 0.95,
    # Minimum test-period size to judge at all
    "min_test_positives": 100,          # buyers / abandons / no-shows in the test period
    "min_test_negatives": 100,
    "min_test_frauds": 50,
    "min_test_events_demand": 100,
    "min_test_events_attendance": 30,
    "min_test_events_crowd": 30,
    # Must-not-get-worse guards
    "max_calibration_error": 0.05,      # predicted 30% should mean ~30% (ECE)
    "max_false_flag_rate": 0.01,        # fraud flags among legitimate orders
    "min_range_coverage": 0.75,         # demand range should hold the real number >= 75% of the time
    "coverage_tolerance": 0.02,         # ...and not be worse than the baseline range by more than this
    # Memorising check
    "max_auc_gap": 0.05,                # train AUC - test AUC
    "min_error_ratio": 0.70,            # train error / test error (lower = memorised the training data)
    # Share used for "top-scored" measures (organizer follow-up capacity)
    "top_fraction": 0.10,
}
