# Live model evaluation — 2026-11-09

Three small, non-mutating samples used the first five single-turn product fixtures from `goldenScenarios`. The inputs and catalog are fictional; no customer conversation or production database was sent. The evaluation uses exact expected tool names, validated arguments, fact references and required content. A failure may therefore reflect an alternative tool call or arguments rather than an incorrect customer-facing answer.

| OpenRouter model                    | Exact scenario passes | Observable result                                                                                                                    |
| ----------------------------------- | --------------------: | ------------------------------------------------------------------------------------------------------------------------------------ |
| `openrouter/free`                   |                   0/5 | One scenario returned a reply; the other four did not meet the expected reply outcome.                                               |
| `nvidia/nemotron-3.5-super-vl:free` |                   0/5 | All five returned a reply, but tool-call and/or fact-reference expectations differed.                                                |
| `google/gemma-4-26b-a4b-it:free`    |                   0/5 | None met the expected reply outcome; a subsequent simple probe returned HTTP 429, so the sample is inconclusive about model quality. |

The live evaluator's target is 95% across its selected fixtures; none of the small samples passed. These fixtures are product examples, not a representative bakery RAG benchmark, and random free-router selection means a repeat may differ. These results do not establish an overall success rate and do not justify changing the production model on their own.

A separate `openrouter/free` run of three synthetic knowledge fixtures (`knowledge-shipping`, `knowledge-no-evidence`, and `knowledge-invented-chunk`) also passed 0/3 under the same exact assertions. In the no-evidence case the outcome was not the expected handover; the report did not establish what a customer would have received. These results reinforce the need for further controlled testing and should not be presented as a production-quality RAG evaluation.

Run only with an explicitly selected model and authorized credentials. The evaluator makes external API calls and some model configurations can incur charges. Keep keys out of output and use synthetic data. Model limits, endpoint availability, and data-processing terms can change. [NVIDIA's free endpoint](https://openrouter.ai/nvidia/nemotron-3.5-super-vl%3Afree) warns against sending confidential or personal data, so it must not be assumed suitable for real customer messages.
