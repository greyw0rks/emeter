// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EmeterPolicyV1} from "./generated/EmeterPolicyV1.sol";
import {ITapeOutFactory, ITapeOutProcessor, ICircuitBeacon} from "./interfaces/ITapeOut.sol";

/// @notice Exact, fail-closed adapter for emeter's six-input stateless TAP-02 policy.
/// @dev Deployment verification must confirm the processor's ERC-1967 beacon slot.
/// Pinning detects ordinary upgrades, not transient malicious storage changes by
/// the upstream factory owner. The TapeOut dependency remains experimental.
contract EmeterPolicyAdapter {
    error InvalidProcessor();
    error InvalidCircuit();
    error InvalidBeacon();

    address public immutable factory;
    address public immutable processor;
    address public immutable beacon;
    address public immutable circuitImplementation;
    uint256 public immutable circuitId;
    bytes32 public immutable processorCodeHash;
    bytes32 public immutable implementationCodeHash;

    uint256 public constant EVALUATION_GAS_LIMIT = 250_000;
    uint256 private constant READ_GAS_LIMIT = 50_000;

    constructor(address factory_, address processor_, uint256 circuitId_, address beacon_) {
        if (factory_.code.length == 0 || processor_.code.length == 0) revert InvalidProcessor();
        if (!ITapeOutFactory(factory_).isCPU(processor_) || ITapeOutProcessor(processor_).factory() != factory_) {
            revert InvalidProcessor();
        }
        if (beacon_.code.length == 0) revert InvalidBeacon();
        address implementation = ICircuitBeacon(beacon_).implementation();
        if (implementation.code.length == 0) revert InvalidBeacon();
        (uint32 nIn, uint32 nOut, uint32 nState, uint32 gates) =
            ITapeOutProcessor(processor_).circuitInfo(circuitId_);
        if (
            nIn != EmeterPolicyV1.N_IN || nOut != EmeterPolicyV1.N_OUT || nState != 0
                || gates != EmeterPolicyV1.GATE_COUNT
                || keccak256(ITapeOutProcessor(processor_).netlist(circuitId_)) != EmeterPolicyV1.NETLIST_HASH
        ) revert InvalidCircuit();

        factory = factory_;
        processor = processor_;
        beacon = beacon_;
        circuitId = circuitId_;
        circuitImplementation = implementation;
        processorCodeHash = processor_.codehash;
        implementationCodeHash = implementation.codehash;
    }

    function netlistHash() external pure returns (bytes32) {
        return EmeterPolicyV1.NETLIST_HASH;
    }

    /// @return allowed Only canonical TAP-02 output 0x01 authorizes payment.
    /// Reverts, missing code, upgrade drift, ABI errors, high bits, and oversized
    /// returndata all return false. Returndata is copied into fixed-size buffers.
    function isAllowed(uint8 inputs) external view returns (bool allowed) {
        if (inputs & 0xc0 != 0 || processor.codehash != processorCodeHash) return false;
        (bool ok, uint256 implementationWord) =
            _readWord(beacon, abi.encodeCall(ICircuitBeacon.implementation, ()));
        if (
            !ok || implementationWord != uint256(uint160(circuitImplementation))
                || circuitImplementation.codehash != implementationCodeHash
        ) return false;

        (ok, implementationWord) = _readWord(factory, abi.encodeCall(ITapeOutFactory.isCPU, (processor)));
        if (!ok || implementationWord != 1) return false;
        if (!_circuitUnchanged()) return false;

        bytes memory callData = abi.encodeCall(ITapeOutProcessor.eval, (circuitId, abi.encodePacked(inputs)));
        address target = processor;
        uint256 gasLimit = EVALUATION_GAS_LIMIT;
        uint256 offset;
        uint256 length;
        uint256 outputWord;
        uint256 size;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, 0)
            mstore(add(ptr, 0x20), 0)
            mstore(add(ptr, 0x40), 0)
            ok := staticcall(gasLimit, target, add(callData, 0x20), mload(callData), ptr, 0x60)
            size := returndatasize()
            offset := mload(ptr)
            length := mload(add(ptr, 0x20))
            outputWord := mload(add(ptr, 0x40))
            mstore(0x40, add(ptr, 0x60))
        }
        // A single output byte is left-aligned within the ABI data word.
        return ok && size == 96 && offset == 32 && length == 1 && outputWord == (uint256(1) << 248);
    }

    function _readWord(address target, bytes memory callData) private view returns (bool ok, uint256 word) {
        uint256 size;
        uint256 gasLimit = READ_GAS_LIMIT;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, 0)
            ok := staticcall(gasLimit, target, add(callData, 0x20), mload(callData), ptr, 0x20)
            size := returndatasize()
            word := mload(ptr)
            mstore(0x40, add(ptr, 0x20))
        }
        ok = ok && size == 32;
    }

    function _circuitUnchanged() private view returns (bool) {
        bytes memory callData = abi.encodeCall(ITapeOutProcessor.circuitInfo, (circuitId));
        address target = processor;
        uint256 gasLimit = READ_GAS_LIMIT;
        bool ok;
        uint256 size;
        uint256 a;
        uint256 b;
        uint256 c;
        uint256 d;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, 0)
            mstore(add(ptr, 0x20), 0)
            mstore(add(ptr, 0x40), 0)
            mstore(add(ptr, 0x60), 0)
            ok := staticcall(gasLimit, target, add(callData, 0x20), mload(callData), ptr, 0x80)
            size := returndatasize()
            a := mload(ptr)
            b := mload(add(ptr, 0x20))
            c := mload(add(ptr, 0x40))
            d := mload(add(ptr, 0x60))
            mstore(0x40, add(ptr, 0x80))
        }
        if (!ok || size != 128 || a != 6 || b != 1 || c != 0 || d != EmeterPolicyV1.GATE_COUNT) return false;

        callData = abi.encodeCall(ITapeOutProcessor.netlist, (circuitId));
        bytes32 hash;
        // Exact policy size: 77 bytes, encoded as 32 offset + 32 length + 96 data.
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, 0)
            mstore(add(ptr, 0x20), 0)
            ok := staticcall(gasLimit, target, add(callData, 0x20), mload(callData), ptr, 0xa0)
            size := returndatasize()
            a := mload(ptr)
            b := mload(add(ptr, 0x20))
            hash := keccak256(add(ptr, 0x40), 77)
            mstore(0x40, add(ptr, 0xa0))
        }
        return ok && size == 160 && a == 32 && b == 77 && hash == EmeterPolicyV1.NETLIST_HASH;
    }
}
