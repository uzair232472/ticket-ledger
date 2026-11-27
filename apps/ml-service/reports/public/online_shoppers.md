# PUBLIC-data experiment: purchase intent on UCI Online Shoppers

**PUBLIC dataset (UCI Online Shoppers Purchasing Intention, CC BY 4.0, Sakar & Kastro 2018). E-commerce, not ticketing; not TicketLedger customer data; experimentation only; not evidence of real-world performance.**

Split by month: train Feb, Mar, May, June, Jul, Aug, Sep; calibrate Oct; test Nov, Dec (4,725 sessions, 20.7% buyers).

| Variant | Test AUC | Top-10% buyer share | Rule top-10% | Calibration error | New visitors top-10% | Returning top-10% |
|---|---|---|---|---|---|---|
| with_PageValues | 0.8244 | 0.7754 | 0.2215 | 0.0681 | 0.96 | 0.6836 |
| without_PageValues | 0.6703 | 0.3803 | 0.2215 | 0.0278 | 0.4687 | 0.3389 |

`PageValues` can include pages visited after the purchase decision; the variant without it is the honest one.
These numbers say nothing about TicketLedger. They only show the method runs on genuinely recorded public data.
