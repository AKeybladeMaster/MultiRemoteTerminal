# REA-00 — supplied archive identity and inventory

Date: 2026-10-23. Host: Windows NT 10.0.26200 x64. Target: user-supplied `MobaXterm_Portable_v26.5.zip` (44,223,170 bytes). Reference version 26.5 is inferred from the archive/member names; no runtime version query was performed.

Question: what shipped artifacts are present, and does the attachment provide behavioral evidence needed for WP-00?

Local skill: `C:\Users\Beasty\.agents\skills\reverse-engineer-anything\SKILL.md`, metadata version 37. No connected REA tools or installed `rea` executable were found. The skill's supported CLI fallback was used, without changing MCP configuration or installing analysis engines:

```powershell
npx --yes rea-agents@6.4.0 inspect-artifact 'C:\Users\Beasty\Downloads\MobaXterm_Portable_v26.5.zip' --format json
```

Complete inline REA Evidence is retained in [REA-00-inventory.json](REA-00-inventory.json). Inspection Evidence ID `ev_242e237380e986d9355317e29c05ed341b22aa2f6727f8f3ddc28a23079b93f6`; inventory Evidence ID `ev_3531b4923ba2e54806255b373d84ae920197b9cfa6a1a14b0d14c70eb7ec133c`; manifest `agm_c99d8b728efd2662f8d7c118e34a715313303ec0e3f0bdbcc224b2f11f6ab766`.

Root SHA-256 (also independently computed with PowerShell): `a26e7e4e2f7bd47a13fbc6d93d08a2d946f21c3e0d135b9e4f55149842c09ef6`.

| Observed member | Format | Uncompressed bytes | SHA-256 |
|---|---|---|---|
| `MobaXterm_Personal_26.5.exe` | PE | 16,601,672 | `f0e77836182fe52e66c68f88fbe13801f935f100623103df1d8be2181294e8e5` |
| `CygUtils.plugin` | ZIP | 19,516,368 | `94216d3d9265296feeb5c0009af5aaff2fd2fdb8693076f291b552b91bdaad82` |
| `CygUtils64.plugin` | ZIP | 13,221,121 | `df8c12a3aa748fa4e8a24278fd0a98deede836bb9d34b6ac21f2a1877943fbb2` |

Confidence: observed static inventory of the root central directory. No integrity contradictions reported. Inventory does not include bytes outside listed central-directory entries and is not a recursive behavior analysis. No artifact extraction, application execution, license acceptance, binary decompilation, asset reuse or copying of implementation occurred.

Conclusion: archive identity answered; terminal/SSH/SFTP/trust/macro behaviors remain unknown. WP-00 needs none of those unknowns. Independent implementation follows the repository contracts (F-012/N-002/N-012); nothing in the archive is used as an instruction or source asset. Later behavioral probes require a concrete uncertainty and controlled lab setup per the original backlog.
