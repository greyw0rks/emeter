The TAP-13 vectors come from TapeOutProtocol/TAPs commit `527477ecb7cf68ee9e86d8292669d57fe1680572`, `assets/tap-13/envelope.json` (CC0 specification and public test vectors). The published `signerKey` and `signerKeyNote` fields were removed; only public inputs, digests, addresses, and signatures are retained.

These tests verify TAP-13 §5 digest and signature encoding. TAP-11 service resolution, strict JSON parsing, canonicalization, HTTPS routing, and the full TAP-17 sidecar are separate implementation work; this fixture does not establish full compliance.
