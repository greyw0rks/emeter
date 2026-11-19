// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @notice Hash-only TAP-13 §5 verifier. JSON canonicalization and TAP-11 service
/// resolution belong outside this library; no full TAP compliance is implied.
library Tap13Receipt {
    struct Receipt {
        bytes32 requestId;
        bytes32 requestHash;
        bytes32 bodyHash;
        uint64 timestamp;
        bool ok;
    }

    function digest(address container, Receipt calldata receipt) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "TAPI-1/resp/v2",
                container,
                receipt.requestId,
                receipt.requestHash,
                receipt.ok ? bytes1(0x01) : bytes1(0x00),
                receipt.bodyHash,
                receipt.timestamp
            )
        );
    }

    function verified(address container, address signer, Receipt calldata receipt, bytes calldata signature)
        internal
        pure
        returns (bool)
    {
        if (signature.length != 65 || receipt.timestamp > 9_007_199_254_740_991) return false;
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 2) v += 27;
        if (v != 27 && v != 28) return false;
        (address recovered, ECDSA.RecoverError error,) =
            ECDSA.tryRecover(MessageHashUtils.toEthSignedMessageHash(digest(container, receipt)), v, r, s);
        return error == ECDSA.RecoverError.NoError && recovered != address(0) && recovered == signer;
    }
}
