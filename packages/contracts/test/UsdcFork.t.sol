// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EngineForkTest} from "./EngineFork.t.sol";
import {DemoUSD} from "../src/DemoUSD.sol";
import {EmeterVault} from "../src/EmeterVault.sol";

/// Uses actual X Layer USDC proxy/token code and the actual TapeOut policy.
/// Funding and every transaction happen only on a disposable local fork.
contract UsdcForkTest is EngineForkTest {
    address constant USDC = 0x74b7F16337b8972027F6196A17a631aC6dE26d22;

    function _deployToken() internal override returns (DemoUSD) {
        assertGt(USDC.code.length, 0);
        assertEq(DemoUSD(USDC).decimals(), 6);
        assertEq(DemoUSD(USDC).symbol(), "USDC");
        return DemoUSD(USDC);
    }
    function _fundToken() internal override {
        deal(USDC, customer, 1_000_000);
        deal(USDC, customerTwo, 1_000_000);
    }
    function testActualUsdcDepositExactApprovalAndWithdrawal() public {
        assertEq(address(vault.token()), USDC);
        assertEq(token.balanceOf(address(vault)), 500_000);
        assertEq(token.allowance(customer, address(vault)), 0);
        vm.prank(customer);
        vault.withdrawAvailable(123_456);
        assertEq(token.balanceOf(customer), 623_456);
        assertEq(vault.availableBalance(customer), 376_544);
        assertEq(token.balanceOf(address(vault)), 376_544);
    }
}
