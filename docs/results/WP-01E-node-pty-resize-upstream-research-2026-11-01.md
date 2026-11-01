# WP-01E upstream ConPTY resize boundary research

**Requirement:** P-02 local terminal sizing and input; F-002 ConPTY input/resize.  
**Status:** No upstream resize-completion or child-redraw acknowledgement identified.  
**Checked:** 2026-11-01.

## Findings

- The repository pins `node-pty@1.1.0`. Its [`IPty.resize()` declaration](https://github.com/microsoft/node-pty/blob/v1.1.0/typings/node-pty.d.ts#L849-L856) returns `void`. In the [Windows ConPTY binding](https://github.com/microsoft/node-pty/blob/v1.1.0/src/win/conpty.cc#L2093-L2153), `PtyResize` calls `ResizePseudoConsole`, discards its result, and returns `undefined`; it does not wait for the child to redraw.
- The GitHub release page marks [`v1.2.0-beta.17`](https://github.com/microsoft/node-pty/releases/tag/v1.2.0-beta.17) as a pre-release. The [official npm version page](https://www.npmjs.com/package/node-pty?activeTab=versions) lists `1.1.0` as the `latest` tag and `1.2.0-beta.18` as `beta`; no stable release newer than 1.1.0 was found. The beta.18 package is published in npm but has no corresponding GitHub tag/release in the repository's [tag](https://github.com/microsoft/node-pty/tags) and [release](https://github.com/microsoft/node-pty/releases) listings. Its [published tarball](https://registry.npmjs.org/node-pty/-/node-pty-1.2.0-beta.18.tgz) was inspected in memory: its typings still declare `resize(...): void` (adding only optional pixel dimensions), and `src/win/conpty.cc` still discards the `ResizePseudoConsole` result and returns `undefined`. The [tagged beta.17 typings](https://github.com/microsoft/node-pty/blob/v1.2.0-beta.17/typings/node-pty.d.ts#L897-L905) and [implementation](https://github.com/microsoft/node-pty/blob/v1.2.0-beta.17/src/win/conpty.cc#L2332-L2392) show the same resize behavior. Beta.17 release notes do not describe a resize acknowledgement or fix.
- Microsoft's [`ResizePseudoConsole` API](https://learn.microsoft.com/en-us/windows/console/resizepseudoconsole) documents an `HRESULT` success/failure return for resizing the pseudoconsole's internal buffers. The [Windows Terminal ConPTY design note](https://github.com/microsoft/terminal/blob/main/doc/specs/%2313000%20-%20In-process%20ConPTY.md#L304-L315) says terminal/ConPTY resizing is asynchronous and may overlap output. These sources support the inference that a successful resize call is not proof of child redraw completion; neither documents a host-side completion acknowledgement.
- A child can receive a `WINDOW_BUFFER_SIZE_RECORD` through its console input buffer when `ENABLE_WINDOW_INPUT` is enabled ([Microsoft Console Input Buffer documentation](https://learn.microsoft.com/en-us/windows/console/console-input-buffer)). That is an optional child-facing size notification, not a generic acknowledgement that an arbitrary shell or full-screen program has processed the resize or redrawn.

## Conclusion and limits

No stable `node-pty` release or inspected ConPTY API provides a general resize-completion/child-redraw acknowledgement or a confirmed fix for the first-input-after-resize issue. This is an upstream interface/source finding, not confirmation of the application's root cause. The npm beta.18 tarball source was inspected because no matching GitHub tag is published; no runtime test of beta.18 or Windows behavior was performed. P-02/F-002 remain open pending repeated Windows acceptance or a reliable synchronization boundary.

No tests, builds, installation/packaging commands, or temporary files were created for this research.
