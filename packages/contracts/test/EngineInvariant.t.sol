// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {EngineFixture} from "./helpers/EngineFixture.sol";
import {DemoUSD} from "../src/DemoUSD.sol";
import {EmeterVault} from "../src/EmeterVault.sol";
import {Tap13Receipt} from "../src/Tap13Receipt.sol";

contract EngineHandler is Test {
    EmeterVault public vault;
    DemoUSD public token;
    address public customer;
    address public delegate;
    address public container;
    uint256 private customerKey;
    uint256 private delegateKey;
    uint256 private providerKey;
    bytes32 public serviceId;
    bytes32[] public sessions;
    uint256 private sessionNonce = 100;
    uint256 public paidOracle;
    uint256 public refundsOracle;

    constructor(EmeterVault vault_, DemoUSD token_, address customer_, address delegate_, address container_,
        uint256 customerKey_, uint256 delegateKey_, uint256 providerKey_, bytes32 serviceId_) {
        vault = vault_; token = token_; customer = customer_; delegate = delegate_; container = container_;
        customerKey = customerKey_; delegateKey = delegateKey_; providerKey = providerKey_; serviceId = serviceId_;
    }

    function sessionCount() external view returns (uint256) { return sessions.length; }
    function _sig(uint256 key, bytes32 digest) private pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function deposit(uint256 seed) external {
        uint256 remaining = token.balanceOf(customer);
        if (remaining == 0) return;
        uint256 amount = bound(seed, 1, remaining);
        vm.startPrank(customer);
        token.approve(address(vault), amount);
        vault.deposit(amount);
        vm.stopPrank();
    }

    function withdraw(uint256 seed) external {
        uint256 available = vault.availableBalance(customer);
        if (available == 0) return;
        vm.prank(customer);
        vault.withdrawAvailable(bound(seed, 1, available));
    }

    function createSession(uint256 seed) external {
        uint256 available = vault.availableBalance(customer);
        if (available < 20_000) return;
        uint256 budget = bound(seed, 20_000, available < 100_000 ? available : 100_000);
        bytes32[] memory services = new bytes32[](1);
        services[0] = serviceId;
        EmeterVault.SessionAuthorization memory grant = EmeterVault.SessionAuthorization({
            customer: customer, signer: delegate, budget: budget, softLimit: budget < 50_000 ? budget : 50_000,
            maxCharge: 20_000, expiresAt: uint64(block.timestamp + 600), settlementWindow: 300,
            serviceSetHash: keccak256(abi.encode(services)), nonce: sessionNonce++
        });
        sessions.push(vault.createSession(grant, services, _sig(customerKey, vault.sessionAuthorizationDigest(grant))));
    }

    function charge(uint256 sessionSeed, uint256 nonceSeed, bool overrideLimit, bool forgedOverride) external {
        if (sessions.length == 0) return;
        bytes32 id = sessions[sessionSeed % sessions.length];
        uint256 nonce = nonceSeed % 20;
        EmeterVault.Session memory session = vault.getSession(id);
        EmeterVault.SettlementEvidence memory evidence;
        evidence.authorization = EmeterVault.ChargeAuthorization({
            sessionId: id, requestId: keccak256(abi.encode("invariant request", id, nonce)),
            requestHash: keccak256(abi.encode("invariant request body", id, nonce)), serviceId: serviceId,
            priceVersion: 1, maxAmount: 20_000, nonce: nonce, issuedAt: uint64(block.timestamp), validUntil: session.expiresAt
        });
        evidence.receipt = Tap13Receipt.Receipt({ requestId: evidence.authorization.requestId,
            requestHash: evidence.authorization.requestHash, bodyHash: keccak256("invariant response"),
            timestamp: uint64(block.timestamp), ok: true });
        evidence.chargeSignature = _sig(delegateKey, vault.chargeAuthorizationDigest(evidence.authorization));
        evidence.providerSignature = _sig(providerKey, MessageHashUtils.toEthSignedMessageHash(keccak256(abi.encodePacked(
            "TAPI-1/resp/v2", container, evidence.receipt.requestId, evidence.receipt.requestHash,
            bytes1(0x01), evidence.receipt.bodyHash, evidence.receipt.timestamp
        ))));
        if (overrideLimit) {
            evidence.softLimitOverride = EmeterVault.SoftLimitOverride({ sessionId: id,
                chargeDigest: vault.chargeAuthorizationDigest(evidence.authorization), maxTotalSpend: session.spent + 20_000,
                validUntil: session.refundAfter });
            evidence.customerOverrideSignature = _sig(forgedOverride ? delegateKey : customerKey,
                vault.softLimitOverrideDigest(evidence.softLimitOverride));
        }
        try vault.settle(evidence) { paidOracle += 20_000; } catch { }
    }

    function close(uint256 seed) external {
        if (sessions.length == 0) return;
        vm.prank(customer);
        try vault.closeSession(sessions[seed % sessions.length]) {} catch {}
    }
    function revoke(uint256 seed) external {
        if (sessions.length == 0) return;
        vm.prank(customer);
        try vault.revokeSessionSigner(sessions[seed % sessions.length]) {} catch {}
    }
    function refund(uint256 seed) external {
        if (sessions.length == 0) return;
        bytes32 id = sessions[seed % sessions.length];
        uint256 before = vault.getSession(id).balance;
        try vault.refund(id) { refundsOracle += before; } catch {}
    }
    function advanceTime(uint256 seed) external { vm.warp(block.timestamp + bound(seed, 0, 400)); }
}

contract EngineInvariantTest is EngineFixture {
    EngineHandler private handler;

    function setUp() public override {
        super.setUp();
        handler = new EngineHandler(vault, token, customer, delegate, container, customerKey, delegateKey, signerKey, serviceA);
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](8);
        selectors[0] = EngineHandler.deposit.selector;
        selectors[1] = EngineHandler.withdraw.selector;
        selectors[2] = EngineHandler.createSession.selector;
        selectors[3] = EngineHandler.charge.selector;
        selectors[4] = EngineHandler.close.selector;
        selectors[5] = EngineHandler.revoke.selector;
        selectors[6] = EngineHandler.refund.selector;
        selectors[7] = EngineHandler.advanceTime.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function invariantTrackedFundsEqualActualVaultBalance() public view {
        assertEq(vault.totalAvailable() + vault.totalLocked(), token.balanceOf(address(vault)));
    }

    function invariantPaymentsMatchIndependentOracleAndProviderTransfers() public view {
        assertEq(vault.totalPaid(), handler.paidOracle());
        assertEq(token.balanceOf(payout), handler.paidOracle());
        assertEq(token.balanceOf(payoutTwo), 0);
    }

    function invariantEverySessionConservesItsSignedBudget() public view {
        uint256 locked;
        uint256 refunded;
        for (uint256 i; i < handler.sessionCount(); ++i) {
            EmeterVault.Session memory session = vault.getSession(handler.sessions(i));
            assertEq(session.balance + session.spent + session.refundedAmount, session.budget);
            assertLe(session.spent, session.budget);
            if (session.status == EmeterVault.SessionStatus.Refunded) assertEq(session.balance, 0);
            locked += session.balance;
            refunded += session.refundedAmount;
        }
        assertEq(locked, vault.totalLocked());
        assertEq(refunded, handler.refundsOracle());
    }

    function invariantTokensAreConservedAcrossCustomersProvidersAndVault() public view {
        assertEq(token.balanceOf(customer) + token.balanceOf(customerTwo) + token.balanceOf(payout)
            + token.balanceOf(payoutTwo) + token.balanceOf(address(vault)), token.totalSupply());
    }
}
