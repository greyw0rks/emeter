// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EmeterRegistry} from "./EmeterRegistry.sol";
import {EmeterPolicyAdapter} from "./EmeterPolicyAdapter.sol";
import {Tap13Receipt} from "./Tap13Receipt.sol";
import {EmeterPolicyV1} from "./generated/EmeterPolicyV1.sol";

/// @notice Prepaid, capped sessions for allowlisted services. One immutable token;
/// no administrator can withdraw customer balances or enlarge signed budgets.
contract EmeterVault is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error InvalidConfiguration();
    error InvalidAmount();
    error UnsupportedTokenTransfer();
    error InsufficientAvailableBalance();
    error InvalidSession();
    error InvalidServiceSet();
    error InvalidSessionSignature();
    error SessionNonceConsumed();
    error UnknownSession();
    error UnauthorizedCustomer();
    error SessionUnavailable();
    error ChargeConsumed();
    error HardBudgetExceeded();
    error AuthorizationExpired();
    error ReceiptBindingFailed();
    error ReceiptExpired();
    error PolicyDenied(uint8 inputs);
    error RefundLocked();

    enum SessionStatus { Unknown, Active, Closing, Refunded }

    struct SessionAuthorization {
        address customer;
        address signer;
        uint256 budget;
        uint256 softLimit;
        uint256 maxCharge;
        uint64 expiresAt;
        uint64 settlementWindow;
        bytes32 serviceSetHash;
        uint256 nonce;
    }

    struct Session {
        address customer;
        address signer;
        uint256 budget;
        uint256 balance;
        uint256 spent;
        uint256 refundedAmount;
        uint256 softLimit;
        uint256 maxCharge;
        uint64 createdAt;
        uint64 expiresAt;
        uint64 executionDeadline;
        uint64 refundAfter;
        uint64 settlementWindow;
        SessionStatus status;
        bool signerRevoked;
    }

    struct ChargeAuthorization {
        bytes32 sessionId;
        bytes32 requestId;
        bytes32 requestHash;
        bytes32 serviceId;
        uint32 priceVersion;
        uint256 maxAmount;
        uint256 nonce;
        uint64 issuedAt;
        uint64 validUntil;
    }

    struct SoftLimitOverride {
        bytes32 sessionId;
        bytes32 chargeDigest;
        uint256 maxTotalSpend;
        uint64 validUntil;
    }

    struct SettlementEvidence {
        ChargeAuthorization authorization;
        bytes chargeSignature;
        Tap13Receipt.Receipt receipt;
        bytes providerSignature;
        SoftLimitOverride softLimitOverride;
        bytes customerOverrideSignature;
    }

    struct Validation {
        uint256 amount;
        uint8 inputs;
        address payout;
        bytes32 receiptDigest;
        bytes32 requestKey;
    }

    bytes32 public constant SESSION_TYPEHASH = keccak256(
        "SessionAuthorization(address customer,address signer,uint256 budget,uint256 softLimit,uint256 maxCharge,uint64 expiresAt,uint64 settlementWindow,bytes32 serviceSetHash,uint256 nonce)"
    );
    bytes32 public constant CHARGE_TYPEHASH = keccak256(
        "ChargeAuthorization(bytes32 sessionId,bytes32 requestId,bytes32 requestHash,bytes32 serviceId,uint32 priceVersion,uint256 maxAmount,uint256 nonce,uint64 issuedAt,uint64 validUntil)"
    );
    bytes32 public constant OVERRIDE_TYPEHASH = keccak256(
        "SoftLimitOverride(bytes32 sessionId,bytes32 chargeDigest,uint256 maxTotalSpend,uint64 validUntil)"
    );
    uint64 public constant MAX_SESSION_DURATION = 30 days;
    uint64 public constant MAX_SETTLEMENT_WINDOW = 1 days;
    uint256 public constant MAX_SESSION_SERVICES = 16;

    IERC20 public immutable token;
    EmeterRegistry public immutable registry;
    EmeterPolicyAdapter public immutable adapter;
    bytes32 public immutable adapterCodeHash;
    mapping(address => uint256) public availableBalance;
    mapping(address => mapping(uint256 => bool)) public consumedSessionNonces;
    mapping(bytes32 => mapping(uint256 => bool)) public consumedChargeNonces;
    mapping(bytes32 => mapping(bytes32 => bool)) public sessionServiceAllowed;
    mapping(bytes32 => bool) public consumedRequests;
    mapping(bytes32 => bool) public consumedReceipts;
    mapping(bytes32 => Session) private _sessions;
    uint256 public totalAvailable;
    uint256 public totalLocked;
    uint256 public totalPaid;

    event Deposited(address indexed payer, address indexed customer, uint256 amount);
    event AvailableWithdrawn(address indexed customer, uint256 amount);
    event SessionCreated(bytes32 indexed sessionId, address indexed customer, address indexed signer,
        uint256 budget, uint256 softLimit, uint64 expiresAt, uint64 refundAfter, bytes32 serviceSetHash);
    event SessionCloseRequested(bytes32 indexed sessionId, uint64 executionDeadline, uint64 refundAfter);
    event SessionSignerRevoked(bytes32 indexed sessionId);
    event ChargeSettled(bytes32 indexed requestId, bytes32 indexed sessionId, bytes32 indexed serviceId,
        uint32 priceVersion, address provider, uint256 amount, uint8 policyInputs, bytes32 receiptDigest);
    event BalanceRefunded(bytes32 indexed sessionId, address indexed customer, uint256 amount);

    constructor(IERC20 token_, EmeterRegistry registry_, EmeterPolicyAdapter adapter_)
        EIP712("emeter Vault", "1") {
        if (address(token_).code.length == 0 || address(registry_).code.length == 0
            || address(adapter_).code.length == 0
            || adapter_.netlistHash() != EmeterPolicyV1.NETLIST_HASH) revert InvalidConfiguration();
        token = token_;
        registry = registry_;
        adapter = adapter_;
        adapterCodeHash = address(adapter_).codehash;
    }

    function getSession(bytes32 sessionId) external view returns (Session memory) {
        if (_sessions[sessionId].status == SessionStatus.Unknown) revert UnknownSession();
        return _sessions[sessionId];
    }

    function sessionIdFor(address customer, uint256 nonce) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), block.chainid, customer, nonce));
    }

    function deposit(uint256 amount) external nonReentrant { _deposit(msg.sender, amount); }

    /// Anyone may sponsor a customer's credit; only that customer can spend it.
    function depositFor(address customer, uint256 amount) external nonReentrant { _deposit(customer, amount); }

    function _deposit(address customer, uint256 amount) private {
        if (customer == address(0) || amount == 0) revert InvalidAmount();
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        if (token.balanceOf(address(this)) - beforeBalance != amount) revert UnsupportedTokenTransfer();
        availableBalance[customer] += amount;
        totalAvailable += amount;
        emit Deposited(msg.sender, customer, amount);
    }

    function withdrawAvailable(uint256 amount) external nonReentrant {
        if (amount == 0 || amount > availableBalance[msg.sender]) revert InvalidAmount();
        availableBalance[msg.sender] -= amount;
        totalAvailable -= amount;
        _transferExact(msg.sender, amount);
        emit AvailableWithdrawn(msg.sender, amount);
    }

    function _transferExact(address recipient, uint256 amount) private {
        uint256 beforeBalance = token.balanceOf(recipient);
        token.safeTransfer(recipient, amount);
        if (token.balanceOf(recipient) - beforeBalance != amount) revert UnsupportedTokenTransfer();
    }

    function sessionAuthorizationDigest(SessionAuthorization calldata authorization) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            SESSION_TYPEHASH, authorization.customer, authorization.signer, authorization.budget,
            authorization.softLimit, authorization.maxCharge, authorization.expiresAt,
            authorization.settlementWindow, authorization.serviceSetHash, authorization.nonce
        )));
    }

    function chargeAuthorizationDigest(ChargeAuthorization calldata authorization) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            CHARGE_TYPEHASH, authorization.sessionId, authorization.requestId, authorization.requestHash,
            authorization.serviceId, authorization.priceVersion, authorization.maxAmount,
            authorization.nonce, authorization.issuedAt, authorization.validUntil
        )));
    }

    function softLimitOverrideDigest(SoftLimitOverride calldata authorization) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            OVERRIDE_TYPEHASH, authorization.sessionId, authorization.chargeDigest,
            authorization.maxTotalSpend, authorization.validUntil
        )));
    }

    function createSession(
        SessionAuthorization calldata authorization,
        bytes32[] calldata serviceIds,
        bytes calldata customerSignature
    ) external nonReentrant returns (bytes32 sessionId) {
        if (authorization.customer == address(0) || authorization.signer == address(0)
            || authorization.budget == 0 || authorization.softLimit > authorization.budget
            || authorization.maxCharge == 0 || authorization.maxCharge > authorization.budget
            || authorization.expiresAt <= block.timestamp
            || authorization.expiresAt > block.timestamp + MAX_SESSION_DURATION
            || authorization.settlementWindow == 0 || authorization.settlementWindow > MAX_SETTLEMENT_WINDOW
            || uint256(authorization.expiresAt) + authorization.settlementWindow > type(uint64).max) revert InvalidSession();
        if (consumedSessionNonces[authorization.customer][authorization.nonce]) revert SessionNonceConsumed();
        if (serviceIds.length == 0 || serviceIds.length > MAX_SESSION_SERVICES
            || keccak256(abi.encode(serviceIds)) != authorization.serviceSetHash) revert InvalidServiceSet();
        bytes32 previous = bytes32(0);
        for (uint256 i; i < serviceIds.length; ++i) {
            if (serviceIds[i] == bytes32(0) || uint256(serviceIds[i]) <= uint256(previous)) revert InvalidServiceSet();
            EmeterRegistry.Service memory service = registry.getService(serviceIds[i]);
            if (!registry.isServiceAuthorized(serviceIds[i], service.latestVersion)) revert InvalidServiceSet();
            previous = serviceIds[i];
        }
        if (!SignatureChecker.isValidSignatureNow(
            authorization.customer, sessionAuthorizationDigest(authorization), customerSignature
        )) revert InvalidSessionSignature();
        if (availableBalance[authorization.customer] < authorization.budget) revert InsufficientAvailableBalance();

        sessionId = sessionIdFor(authorization.customer, authorization.nonce);
        consumedSessionNonces[authorization.customer][authorization.nonce] = true;
        availableBalance[authorization.customer] -= authorization.budget;
        totalAvailable -= authorization.budget;
        totalLocked += authorization.budget;
        Session storage session = _sessions[sessionId];
        session.customer = authorization.customer;
        session.signer = authorization.signer;
        session.budget = authorization.budget;
        session.balance = authorization.budget;
        session.softLimit = authorization.softLimit;
        session.maxCharge = authorization.maxCharge;
        session.createdAt = uint64(block.timestamp);
        session.expiresAt = authorization.expiresAt;
        session.executionDeadline = authorization.expiresAt;
        session.refundAfter = authorization.expiresAt + authorization.settlementWindow;
        session.settlementWindow = authorization.settlementWindow;
        session.status = SessionStatus.Active;
        for (uint256 i; i < serviceIds.length; ++i) sessionServiceAllowed[sessionId][serviceIds[i]] = true;
        emit SessionCreated(sessionId, session.customer, session.signer, session.budget, session.softLimit,
            session.expiresAt, session.refundAfter, authorization.serviceSetHash);
    }

    /// Stops newly reported execution. The original refund deadline is retained
    /// so closing cannot pull funds out from under outstanding authorizations.
    function closeSession(bytes32 sessionId) external nonReentrant {
        Session storage session = _sessions[sessionId];
        if (session.status == SessionStatus.Unknown) revert UnknownSession();
        if (msg.sender != session.customer) revert UnauthorizedCustomer();
        if (session.status != SessionStatus.Active || block.timestamp >= session.expiresAt) revert SessionUnavailable();
        session.executionDeadline = uint64(block.timestamp);
        session.status = SessionStatus.Closing;
        emit SessionCloseRequested(sessionId, session.executionDeadline, session.refundAfter);
    }

    /// Emergency revocation intentionally invalidates pending charges too.
    /// It never unlocks a balance before the original settlement window ends.
    function revokeSessionSigner(bytes32 sessionId) external nonReentrant {
        Session storage session = _sessions[sessionId];
        if (session.status == SessionStatus.Unknown) revert UnknownSession();
        if (msg.sender != session.customer) revert UnauthorizedCustomer();
        if (session.status == SessionStatus.Refunded) revert SessionUnavailable();
        session.signerRevoked = true;
        emit SessionSignerRevoked(sessionId);
    }

    function _checkTiming(Session storage session, ChargeAuthorization calldata auth, Tap13Receipt.Receipt calldata receipt)
        private view {
        if (auth.issuedAt < session.createdAt || auth.issuedAt > block.timestamp
            || auth.issuedAt > session.executionDeadline || auth.validUntil < auth.issuedAt
            || auth.validUntil > session.expiresAt
            || block.timestamp > uint256(auth.validUntil) + session.settlementWindow) revert AuthorizationExpired();
        if (receipt.timestamp < auth.issuedAt || receipt.timestamp > session.executionDeadline
            || receipt.timestamp > auth.validUntil || receipt.timestamp > block.timestamp
            || block.timestamp - receipt.timestamp > session.settlementWindow) revert ReceiptExpired();
    }

    function _overrideValid(Session storage session, SettlementEvidence calldata evidence, bytes32 chargeDigest, uint256 amount)
        private view returns (bool) {
        SoftLimitOverride calldata grant = evidence.softLimitOverride;
        if (evidence.customerOverrideSignature.length == 0
            || grant.sessionId != evidence.authorization.sessionId || grant.chargeDigest != chargeDigest
            || grant.maxTotalSpend < session.spent + amount || grant.maxTotalSpend > session.budget
            || grant.validUntil < block.timestamp || grant.validUntil > session.refundAfter) return false;
        return SignatureChecker.isValidSignatureNow(
            session.customer, softLimitOverrideDigest(grant), evidence.customerOverrideSignature
        );
    }

    function _validate(SettlementEvidence calldata evidence) private view returns (Validation memory result) {
        ChargeAuthorization calldata auth = evidence.authorization;
        Session storage session = _sessions[auth.sessionId];
        if (session.status == SessionStatus.Unknown) revert UnknownSession();
        if (session.status == SessionStatus.Refunded || session.signerRevoked
            || block.timestamp >= session.refundAfter) revert SessionUnavailable();
        result.requestKey = keccak256(abi.encode(auth.sessionId, auth.requestId));
        if (consumedChargeNonces[auth.sessionId][auth.nonce] || consumedRequests[result.requestKey]) revert ChargeConsumed();
        if (auth.requestId == bytes32(0) || auth.requestHash == bytes32(0)
            || evidence.receipt.requestId != auth.requestId || evidence.receipt.requestHash != auth.requestHash
            || evidence.receipt.bodyHash == bytes32(0)) revert ReceiptBindingFailed();
        _checkTiming(session, auth, evidence.receipt);

        EmeterRegistry.PriceVersion memory terms = registry.getPriceVersion(auth.serviceId, auth.priceVersion);
        result.amount = terms.price;
        result.payout = terms.payout;
        if (terms.payout == address(this)) revert InvalidConfiguration();
        if (terms.price > session.balance || terms.price > session.budget - session.spent
            || terms.price > session.maxCharge || auth.maxAmount == 0
            || auth.maxAmount > session.maxCharge) revert HardBudgetExceeded();
        result.receiptDigest = Tap13Receipt.digest(terms.container, evidence.receipt);
        if (consumedReceipts[result.receiptDigest]) revert ChargeConsumed();
        bytes32 chargeDigest = chargeAuthorizationDigest(auth);
        if (sessionServiceAllowed[auth.sessionId][auth.serviceId]
            && registry.isServiceAuthorized(auth.serviceId, auth.priceVersion)) result.inputs |= 1;
        if (evidence.receipt.ok && Tap13Receipt.verified(
            terms.container, terms.signer, evidence.receipt, evidence.providerSignature
        )) result.inputs |= 2;
        if (terms.price <= auth.maxAmount && SignatureChecker.isValidSignatureNow(
            session.signer, chargeDigest, evidence.chargeSignature
        )) result.inputs |= 4;
        result.inputs |= 8; // Known, non-refunded session inside its locked window.
        if (terms.price <= session.softLimit && session.spent <= session.softLimit - terms.price) result.inputs |= 16;
        if (_overrideValid(session, evidence, chargeDigest, terms.price)) result.inputs |= 32;
    }

    function _circuitAllowed(uint8 inputs) private view returns (bool) {
        if (address(adapter).codehash != adapterCodeHash) return false;
        try adapter.isAllowed(inputs) returns (bool allowed) { return allowed; }
        catch { return false; }
    }

    function previewSettlement(SettlementEvidence calldata evidence) external view returns (
        uint256 amount, uint8 policyInputs, bool circuitAllowed
    ) {
        Validation memory result = _validate(evidence);
        return (result.amount, result.inputs, _circuitAllowed(result.inputs));
    }

    function settle(SettlementEvidence calldata evidence) external nonReentrant {
        Validation memory result = _validate(evidence);
        if (!_circuitAllowed(result.inputs)) revert PolicyDenied(result.inputs);
        Session storage session = _sessions[evidence.authorization.sessionId];
        consumedChargeNonces[evidence.authorization.sessionId][evidence.authorization.nonce] = true;
        consumedRequests[result.requestKey] = true;
        consumedReceipts[result.receiptDigest] = true;
        session.balance -= result.amount;
        session.spent += result.amount;
        totalLocked -= result.amount;
        totalPaid += result.amount;
        _transferExact(result.payout, result.amount);
        emit ChargeSettled(evidence.authorization.requestId, evidence.authorization.sessionId,
            evidence.authorization.serviceId, evidence.authorization.priceVersion, result.payout,
            result.amount, result.inputs, result.receiptDigest);
    }

    /// A relayer may refund, but the destination is always the fixed customer.
    function refund(bytes32 sessionId) external nonReentrant {
        Session storage session = _sessions[sessionId];
        if (session.status == SessionStatus.Unknown) revert UnknownSession();
        if (session.status == SessionStatus.Refunded) revert SessionUnavailable();
        if (block.timestamp < session.refundAfter) revert RefundLocked();
        uint256 amount = session.balance;
        session.balance = 0;
        session.refundedAmount = amount;
        session.status = SessionStatus.Refunded;
        totalLocked -= amount;
        if (amount != 0) _transferExact(session.customer, amount);
        emit BalanceRefunded(sessionId, session.customer, amount);
    }
}
