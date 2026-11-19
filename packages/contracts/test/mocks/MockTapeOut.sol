// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EmeterPolicyV1} from "../../src/generated/EmeterPolicyV1.sol";

/// @dev Test-only processor doubles. Never used by deployment scripts.
contract MockFactory {
    mapping(address => bool) public isCPU;

    function register(address processor, bool value) external {
        isCPU[processor] = value;
    }
}

contract MockBeacon {
    address public implementation;

    constructor(address implementation_) {
        implementation = implementation_;
    }

    function setImplementation(address implementation_) external {
        implementation = implementation_;
    }
}

contract MockProcessor {
    address public immutable factory;
    uint8 public mode;

    constructor(address factory_) {
        factory = factory_;
    }

    function setMode(uint8 mode_) external {
        mode = mode_;
    }

    function circuitInfo(uint256) external view returns (uint32, uint32, uint32, uint32) {
        return mode == 9 ? (6, 1, 1, 11) : (6, 1, 0, 11);
    }

    function netlist(uint256) external view returns (bytes memory) {
        bytes memory data = EmeterPolicyV1.netlist();
        if (mode == 10) data[3] = 0x05;
        return data;
    }

    function eval(uint256, bytes calldata inputs) external view returns (bytes memory) {
        if (mode == 1) return hex"";
        if (mode == 2) return hex"0100";
        if (mode == 3) return hex"02";
        if (mode == 4) return hex"81";
        if (mode == 5) revert("unavailable processor");
        if (mode == 6) {
            assembly ("memory-safe") {
                mstore(0, 64)
                mstore(32, 1)
                mstore(64, shl(248, 1))
                return(0, 96)
            }
        }
        if (mode == 7) {
            assembly ("memory-safe") {
                mstore(0, 32)
                mstore(32, 1)
                mstore(64, shl(248, 1))
                return(0, 95)
            }
        }
        if (mode == 8) {
            assembly {
                for {} 1 {} { }
            }
        }
        if (mode == 11) {
            assembly {
                mstore(0, 32)
                mstore(32, 1)
                mstore(64, shl(248, 1))
                return(0, 1000000)
            }
        }
        if (mode == 12) {
            assembly ("memory-safe") {
                mstore(0, 32)
                mstore(32, 1)
                mstore(64, add(shl(248, 1), 1))
                return(0, 96)
            }
        }
        bool[] memory signals = new bool[](19);
        signals[1] = true;
        for (uint256 i; i < 6; ++i) signals[2 + i] = (uint8(inputs[0]) & uint8(1 << i)) != 0;
        bytes memory data = EmeterPolicyV1.netlist();
        for (uint256 offset; offset < data.length; offset += 7) {
            uint256 a = (uint256(uint8(data[offset + 1])) << 16)
                | (uint256(uint8(data[offset + 2])) << 8) | uint8(data[offset + 3]);
            uint256 b = (uint256(uint8(data[offset + 4])) << 16)
                | (uint256(uint8(data[offset + 5])) << 8) | uint8(data[offset + 6]);
            signals[8 + offset / 7] = !(signals[a] && signals[b]);
        }
        return abi.encodePacked(signals[18] ? bytes1(0x01) : bytes1(0x00));
    }
}
