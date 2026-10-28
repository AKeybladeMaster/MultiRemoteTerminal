# ADR-0056: Bounded Java Properties text syntax profile

- **Status:** Accepted
- **Date:** 2026-10-28
- **Requirement:** F-014 / P-27

## Context

Java Properties files are common in Java applications and enterprise configuration. The Java SE Properties documentation describes comments, separators, escaped keys and physical-line continuation. The editor already has one pure-domain tokenizer and a shared bounded renderer preview, so a small lexical profile can improve readability without adding a parser or changing file behavior.

## Decision

Add a properties profile to the shared domain tokenizer. Auto-detect filenames ending in .properties, case-insensitively, and allow manual selection in the local and SFTP editors.

Color leading # and ! comment lines, property keys through the first unescaped equals sign, colon or space/tab/form-feed separator, the separator span, and the remaining physical-line value as opaque text. Inline comment markers are part of the value. Do not decode escapes or join continued logical entries; leave every physical line in a continued entry uncolored so continuation text cannot be mistaken for a new property.

Reuse the shared 64,000 UTF-16 code-unit and 4,096-token bounds. Leave an incomplete final physical line uncolored when the code-unit bound cuts through it. This is a visual aid, not a parser, escape decoder or validator. No package, IPC command, persistence, logging or save behavior is added.

The lexical subset is based on the Java SE Properties line format documented by Oracle: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Properties.html.

## Consequences

- Local and SFTP editors keep the same accessible textarea, aria-hidden token overlay and source bytes.
- Physical continuation groups remain plain text; raw Unicode and escape sequences are not interpreted.
- F-014/P-27 remain partial for broader profile coverage and full editor acceptance.
