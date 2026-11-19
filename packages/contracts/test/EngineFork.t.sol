// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EngineFixture} from "./helpers/EngineFixture.sol";
import {EmeterVault} from "../src/EmeterVault.sol";
import {EmeterPolicyAdapter} from "../src/EmeterPolicyAdapter.sol";

/// All registry/session/token mutations are local fork tests, not mainnet txs.
contract EngineForkTest is EngineFixture {
    function _deployPolicy() internal override returns (EmeterPolicyAdapter) {
        vm.createSelectFork(vm.envOr("X_LAYER_RPC_URL", string("https://rpc.xlayer.tech")));
        assertEq(block.chainid, 196);
        EmeterPolicyAdapter live = EmeterPolicyAdapter(0x87DB7961f425dDb39c54a8582D21f91a57C637B5);
        assertTrue(live.isAllowed(31));
        assertFalse(live.isAllowed(15));
        return live;
    }

    function testRealPolicyGatesScopedDelegatedRequestsAndOwnerOverride() public {
        bytes32 id = _session(1);
        vault.settle(_evidence(id, serviceA, 1, 1));
        EmeterVault.SettlementEvidence memory wrong = _ownerOverride(_evidence(id, serviceB, 1, 2), 70_000, delegateKey);
        vm.expectRevert(abi.encodeWithSelector(EmeterVault.PolicyDenied.selector, uint8(15)));
        vault.settle(wrong);
        vault.settle(_ownerOverride(_evidence(id, serviceB, 1, 2), 70_000, customerKey));
        assertEq(vault.getSession(id).spent, 70_000);
        assertEq(token.balanceOf(payout), 20_000);
        assertEq(token.balanceOf(payoutTwo), 50_000);
    }

    function testRealPolicyPaysTheSignedPriceVersionAfterPriceChange() public {
        bytes32 id = _session(1);
        EmeterVault.SettlementEvidence memory old = _evidence(id, serviceA, 1, 1);
        vm.prank(provider);
        registry.publishPriceVersion(serviceA, payout, signer, container, 30_000, keccak256("new price"));
        vault.settle(old);
        assertEq(token.balanceOf(payout), 20_000);
        vault.settle(_evidence(id, serviceA, 2, 2));
        assertEq(token.balanceOf(payout), 50_000);
    }

    function testRealPolicySupportsClosureOutstandingSettlementAndRefund() public {
        bytes32 id = _session(1);
        EmeterVault.SettlementEvidence memory pending = _evidence(id, serviceA, 1, 1);
        vm.warp(block.timestamp + 1);
        vm.prank(customer);
        vault.closeSession(id);
        vault.settle(pending);
        vm.expectRevert(EmeterVault.RefundLocked.selector);
        vault.refund(id);
        vm.warp(vault.getSession(id).refundAfter);
        vault.refund(id);
        assertEq(token.balanceOf(customer), 680_000);
        assertEq(vault.getSession(id).refundedAmount, 180_000);
    }
}
