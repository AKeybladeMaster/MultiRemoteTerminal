# Domain Docs

How the engineering skills should consume this repo's domain documentation.

## Before exploring

- Read `docs/GLOSSARY.md` and use its terms consistently.
- Read relevant decisions in `docs/adr/` before proposing changes in those areas.
- If either location is absent, proceed without flagging the absence or suggesting upfront documentation work.

## File structure

This is one product context with shared domain documentation:

```text
docs/GLOSSARY.md
docs/adr/
```

## Use the glossary's vocabulary

Use glossary terms in issue titles, proposals, hypotheses, and test names. If a needed term is missing, reconsider whether it is a project term or note the gap for domain modeling.

## Flag ADR conflicts

Surface conflicts with existing ADRs explicitly rather than silently overriding them.
