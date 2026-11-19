# Protocol review

Reviewed on 19 November 2026. Specifications are pinned to TapeOutProtocol/TAPs commit `527477ecb7cf68ee9e86d8292669d57fe1680572`.

| Reference | Implemented or learned |
| --- | --- |
| [TAP-02: Circuit Netlist Format and Evaluation Semantics](https://github.com/TapeOutProtocol/TAPs/blob/527477ecb7cf68ee9e86d8292669d57fe1680572/TAPs/TAP-02.md) | Stateless NAND encoding and evaluation. Each record is opcode `0x00`, then two big-endian `u24` indices; inputs and outputs use LSB-first bits. Signals 0/1 are constants, inputs start at 2, and circuit outputs are the last produced signals. |
| [TAP-10: DeWEB Access and Messaging Layers](https://github.com/TapeOutProtocol/TAPs/blob/527477ecb7cf68ee9e86d8292669d57fe1680572/TAPs/TAP-10.md) | This is the actual title of TAP-10. Its deployment tables and Appendix A provide factory, beacon, opener, and processor interfaces. No DeWEB hosting or messaging is implemented in this milestone. |
| [TAP-13: Signed Responses for Container Services](https://github.com/TapeOutProtocol/TAPs/blob/527477ecb7cf68ee9e86d8292669d57fe1680572/TAPs/TAP-13.md) | Exact §5 digest and low-s signature rules implemented in TypeScript and Solidity. The 139-byte preimage contains `TAPI-1/resp/v2`, container, id hash, request hash, signed response `ok`, body hash, and timestamp, followed by EIP-191 signing. Official public signature vectors pass. |
| [TAP-17: AI Usage Receipts for Container Services](https://github.com/TapeOutProtocol/TAPs/blob/527477ecb7cf68ee9e86d8292669d57fe1680572/TAPs/TAP-17.md) | Reviewed for the next gateway milestone. Its amounts use integer arithmetic and eight decimal digits; a receipt is a statement of reported usage, not settlement. The AI sidecar, price tables, upstream calls, streaming verification, and receipt lookup are still to be built. |
| [TAP-11: TapeAPI Service Manifest and Holder Delegation](https://github.com/TapeOutProtocol/TAPs/blob/527477ecb7cf68ee9e86d8292669d57fe1680572/TAPs/TAP-11.md) | TAP-13/17 depend on TAP-11 service resolution and strict canonical JSON. Full manifest resolution and untrusted-envelope parsing are outside this proof. |

All four requested proposals are Draft. The original TAP-02 draft's verified-source comparison covers BNB Smart Chain; its text explicitly leaves the Layer 2 implementation unverified. emeter therefore checks the live X Layer deployment and executes the netlist on the actual processor implementation in a fork and on mainnet.

## Live deployment findings

The machine-readable pinned-block results are in [xlayer-preflight.json](evidence/xlayer-preflight.json). Independent reads from `rpc.xlayer.tech` and `xlayer.drpc.org` agree.

- Chain ID: `196`, native fee token: OKB.
- Factory: `0x1f09DAeFA827f02CBb40967cc91b259763760761`.
- Current factory implementation: `0x336e9F0F4c3fEe7C8c803377e4DEA00293f4ae2a`, different from the draft's `0x74956236Ab64eD143933040B4137E8A352e4d17b`.
- Factory is not sealed. 435 processors were registered at the initial check.
- Beacon: `0xf70d1ed4f62CF3780157B0b421b7E2F45bD0991C`.
- Circuit implementation: `0x977f217887E085D298Cb3819cDAD5A0ee35F29B2`.
- Processor proxy code hash: `0x57aa306fd0be97087da3534e03398f5ff4efd533b5be4e45a405ce86fa6717d5`.

The current factory quotes new-processor and transistor protocol fees in BEM, with eight decimals. The proof instead publishes emeter's original policy on existing processor `0x67be9042961344ccd387b04C24747B0c6C6D2212`, factory index 100, whose legacy transistor implementation charges native OKB. This is an existing processor, not an emeter-owned processor deployment.

| Publication component | OKB |
| --- | ---: |
| 11 NAND transistors at 0.00001 each | 0.00011 |
| Legacy transistor mint protocol fee | 0.00066 |
| Circuit tape-out fee | 0.0013 |
| Total before transaction gas | 0.00207 |

The native-fee mint and transistor burn were tested on the actual deployed implementation in both Foundry and Anvil forks before mainnet publication. Circuit IDs come from the confirmed `TapedOut` event. The deployed `nextId()` value behaves as a counter of assigned IDs; the proof does not guess a new ID from the draft's description.

X Layer's read-only state-override probe successfully executed `MCOPY`, returning the expected 32-byte value ending in `aa`. Contracts target Cancun with Solidity 0.8.30 because OpenZeppelin 5.6.1 uses that instruction. Transaction execution on X Layer further validates the target.

## Receipt boundary

This milestone implements TAP-13's digest and signature rules, not a complete TAP-13/TAP-17 container service. The proof computes the real container address with `accountOf(processor, circuitId)` and fixes its provider signer in the proof vault. There is no published TAP-11 manifest or claimed full service resolution.

The runner performs an actual local schema validation, signs the resulting body hash, and settles DEMO. It does not call an AI provider or implement the paid HTTP gateway. Both proof wallets are controlled by the builder and do not establish independent adoption.

A TAP-13 response's signed `ok` reports response success. A TAP-17 usage receipt's outer `ok` is always true, including receipts for unsuccessful upstream answers. The production gateway must check its authenticated status/completion fields and must not treat that outer receipt flag as successful delivery. Neither format independently proves correctness, usefulness, or customer acceptance.

## Reference provenance

`packages/circuit/test/fixtures/tap-02-vectors.json` is the unmodified official public vector file. `scripts/verify/tap02_reference.py` is the inspected, unmodified MIT reference interpreter from the pinned commit; it independently agrees with all 64 emeter policy vectors. TAP-13 signature fixtures omit the published test private key. Specifications and test vectors are CC0; the interpreter is MIT.
