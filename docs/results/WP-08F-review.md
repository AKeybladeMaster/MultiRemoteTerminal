# WP-08F two-axis review

**Review range:** `28779c2de801e114a386afd7ec5c864666bb9f17...60f047f5ae97d042dbda8febdc341cbd0ef6861a`

**Commits:** `fdd3d39` feature; `60f047f` review fixes

## Standards

Initial review found one low-severity documented-bound breach: token scanners could inspect or extend a token past the 64,000-code-unit preview limit. It also noted a possible duplicated line-ending scan. The scanner now guards lookahead and token ends against `limit`; Shell and PowerShell share `scanLineEnd`. New boundary regression coverage asserts that every token ends at or before `highlightedThrough`.

Final Standards follow-up: **no remaining findings; ready to merge.** The pure domain tokenizer, renderer-only preview, accessible textarea and existing no-execution behavior remain consistent with repository rules.

## Spec

Initial review found that `Foo#Bar` and `Foo<#Bar#>` could be colored as comments even though those markers belong to a bareword. The scanner now avoids starting a comment after a bareword, with regression coverage for both forms.

Final Spec follow-up: **no missing WP-08F requirements, scope creep or material incorrect behavior; ready to merge.** P-27/F-014 remain PARTIAL for broader language coverage and autosave.

## Summary

Final findings: Standards **0**; Spec **0**. The two review findings were fixed and covered before promotion. Validation is recorded in [WP-08F results](WP-08F-powershell-syntax-profile-2026-10-27.md).
