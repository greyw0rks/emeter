// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EmeterPolicyAdapter} from "../src/EmeterPolicyAdapter.sol";
import {MockFactory, MockBeacon, MockProcessor} from "./mocks/MockTapeOut.sol";

contract EmeterPolicyAdapterTest is Test {
    MockFactory internal factory;
    MockProcessor internal processor;
    MockBeacon internal beacon;
    EmeterPolicyAdapter internal adapter;

    function setUp() public {
        factory = new MockFactory();
        processor = new MockProcessor(address(factory));
        beacon = new MockBeacon(address(processor));
        factory.register(address(processor), true);
        adapter = new EmeterPolicyAdapter(address(factory), address(processor), 1, address(beacon));
    }

    function testValidPolicySucceeds() public view {
        assertTrue(adapter.isAllowed(0x1f));
        assertTrue(adapter.isAllowed(0x2f));
        assertTrue(adapter.isAllowed(0x3f));
    }

    function testInvalidPolicyRejected() public view {
        assertFalse(adapter.isAllowed(0x0f));
        assertFalse(adapter.isAllowed(0x1e));
        assertFalse(adapter.isAllowed(0x00));
    }

    function testFullTruthTable() public view {
        for (uint8 inputs; inputs < 64; ++inputs) {
            bool expected = (inputs & 0x0f) == 0x0f && (inputs & 0x30) != 0;
            assertEq(adapter.isAllowed(inputs), expected);
        }
    }

    function testFuzzAllPackedInputBytes(uint8 inputs) public view {
        bool expected = (inputs & 0xc0) == 0 && (inputs & 0x0f) == 0x0f && (inputs & 0x30) != 0;
        assertEq(adapter.isAllowed(inputs), expected);
    }

    function testMalformedResponsesFailClosed() public {
        for (uint8 mode = 1; mode <= 7; ++mode) {
            processor.setMode(mode);
            assertFalse(adapter.isAllowed(0x1f), "malformed response must never authorize");
        }
        processor.setMode(12);
        assertFalse(adapter.isAllowed(0x1f));
    }

    function testUnavailableProcessorFailsClosed() public {
        vm.etch(address(processor), hex"");
        assertFalse(adapter.isAllowed(0x1f));
    }

    function testGasExhaustionFailsClosed() public {
        processor.setMode(8);
        assertFalse(adapter.isAllowed(0x1f));
    }

    function testReturnDataBombFailsClosed() public {
        processor.setMode(11);
        assertFalse(adapter.isAllowed(0x1f));
    }

    function testUpgradeDriftFailsClosed() public {
        beacon.setImplementation(address(new MockProcessor(address(factory))));
        assertFalse(adapter.isAllowed(0x1f));
    }

    function testImplementationCodeDriftFailsClosed() public {
        vm.etch(address(processor), hex"00");
        assertFalse(adapter.isAllowed(0x1f));
    }

    function testMetadataOrNetlistDriftFailsClosed() public {
        processor.setMode(9);
        assertFalse(adapter.isAllowed(0x1f));
        processor.setMode(10);
        assertFalse(adapter.isAllowed(0x1f));
    }

    function testRegistrationLossFailsClosed() public {
        factory.register(address(processor), false);
        assertFalse(adapter.isAllowed(0x1f));
    }

    function testConstructorRejectsUnregisteredProcessor() public {
        factory.register(address(processor), false);
        vm.expectRevert(EmeterPolicyAdapter.InvalidProcessor.selector);
        new EmeterPolicyAdapter(address(factory), address(processor), 1, address(beacon));
    }

    function testConstructorRejectsDifferentCircuit() public {
        processor.setMode(10);
        vm.expectRevert(EmeterPolicyAdapter.InvalidCircuit.selector);
        new EmeterPolicyAdapter(address(factory), address(processor), 1, address(beacon));
    }

    function testConstructorRejectsStatefulCircuit() public {
        processor.setMode(9);
        vm.expectRevert(EmeterPolicyAdapter.InvalidCircuit.selector);
        new EmeterPolicyAdapter(address(factory), address(processor), 1, address(beacon));
    }
}
