# PUBLIC-data experiment: the fraud method on ULB card fraud

**PUBLIC dataset (ULB Credit Card Fraud, Dal Pozzolo et al. 2015, OpenML 1597). Card transactions with anonymised features, NOT ticket scalping; not TicketLedger data; a check of the fraud METHOD only; not evidence of real-world performance for TicketLedger.**

chronological by Time: oldest 60% train, next 20% calibrate + threshold, newest 20% test
(56,962 test transactions, 75 frauds).

| | Flagged | Share of flags that are fraud | Frauds caught | False flags | AUC | Avg precision |
|---|---|---|---|---|---|---|
| Model | 568 | 0.1127 | 0.8533 | 0.00886 | 0.9855 | 0.7561 |
| Rule (largest amounts) | 416 | 0.0024 | 0.0133 | 0.0073 | | |

95% interval of the recall gain: [0.7666, 0.9197]. Fraud base rate 0.132%: the model's flags are 85.6x more likely to be fraud than a random transaction.

Same method as the app's fraud model (chronological split, isotonic calibration on a later period, threshold fixed before the test at 1% false flags, comparison with a rule at a similar flag budget). Card fraud is not scalping: these numbers say the method works on real rare fraud, not that the TicketLedger model does.
