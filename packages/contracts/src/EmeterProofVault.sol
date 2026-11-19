// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EmeterPolicyAdapter} from "./EmeterPolicyAdapter.sol";
import {Tap13Receipt} from "./Tap13Receipt.sol";

/// @notice Isolated single-customer, single-service protocol proof, using only
/// DemoUSD. It is not the multi-service/session billing product from the roadmap.
contract EmeterProofVault is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error UnauthorizedCustomer();
    error InvalidConfiguration();
    error FundingClosed();
    error AmountInvalid();
    error HardBudgetExceeded();
    error AlreadyConsumed();
    error AuthorizationExpired();
    error ReceiptBindingFailed();
    error ReceiptExpired();
    error PolicyDenied(uint8 inputs);
    error RefundLocked();

    struct Configuration {
        address customer;
        address provider;
        address providerSigner;
        address serviceContainer;
        bytes32 serviceId;
        uint256 price;
        uint256 hardBudget;
        uint256 softLimit;
        uint64 expiresAt;
        uint64 settlementWindow;
    }

    struct ChargeAuthorization {
        bytes32 requestId;
        bytes32 requestHash;
        bytes32 serviceId;
        uint256 maxAmount;
        uint256 nonce;
        uint64 validUntil;
        bool overrideSoftLimit;
    }

    bytes32 public constant CHARGE_TYPEHASH = keccak256(
        "ChargeAuthorization(bytes32 requestId,bytes32 requestHash,bytes32 serviceId,uint256 maxAmount,uint256 nonce,uint64 validUntil,bool overrideSoftLimit)"
    );
    uint64 public constant MAX_RECEIPT_SKEW = 300;
    IERC20 public immutable token;
    EmeterPolicyAdapter public immutable adapter;
    address public immutable customer;
    address public immutable provider;
    address public immutable providerSigner;
    address public immutable serviceContainer;
    bytes32 public immutable serviceId;
    uint256 public immutable price;
    uint256 public immutable hardBudget;
    uint256 public immutable softLimit;
    uint64 public immutable expiresAt;
    uint64 public immutable refundAfter;
    uint256 public balance;
    uint256 public spent;
    bool public refunded;
    mapping(bytes32 => bool) public consumedRequests;
    mapping(uint256 => bool) public consumedNonces;

    event SessionFunded(address indexed customer, uint256 amount);
    event ChargeSettled(
        bytes32 indexed requestId, bytes32 indexed serviceId, address indexed provider,
        uint256 amount, uint8 policyInputs, address processor, uint256 circuitId
    );
    event BalanceRefunded(address indexed customer, uint256 amount);

    constructor(IERC20 token_, EmeterPolicyAdapter adapter_, Configuration memory config)
        EIP712("emeter Proof Vault", "1")
    {
        if (
            address(token_).code.length == 0 || address(adapter_).code.length == 0
                || config.customer == address(0) || config.provider == address(0)
                || config.providerSigner == address(0) || config.serviceContainer == address(0)
                || config.serviceId == bytes32(0) || config.price == 0 || config.price > config.hardBudget
                || config.softLimit > config.hardBudget || config.expiresAt <= block.timestamp
                || config.settlementWindow == 0 || config.settlementWindow > 1 days
                || uint256(config.expiresAt) + config.settlementWindow > type(uint64).max
        ) revert InvalidConfiguration();
        token = token_;
        adapter = adapter_;
        customer = config.customer;
        provider = config.provider;
        providerSigner = config.providerSigner;
        serviceContainer = config.serviceContainer;
        serviceId = config.serviceId;
        price = config.price;
        hardBudget = config.hardBudget;
        softLimit = config.softLimit;
        expiresAt = config.expiresAt;
        refundAfter = config.expiresAt + config.settlementWindow;
    }

    function deposit(uint256 amount) external nonReentrant {
        if (msg.sender != customer) revert UnauthorizedCustomer();
        if (block.timestamp >= expiresAt || refunded) revert FundingClosed();
        if (amount == 0 || amount > hardBudget - spent - balance) revert AmountInvalid();
        token.safeTransferFrom(customer, address(this), amount);
        balance += amount;
        emit SessionFunded(customer, amount);
    }

    function authorizationDigest(ChargeAuthorization calldata authorization) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    CHARGE_TYPEHASH, authorization.requestId, authorization.requestHash, authorization.serviceId,
                    authorization.maxAmount, authorization.nonce, authorization.validUntil,
                    authorization.overrideSoftLimit
                )
            )
        );
    }

    /// @notice Anyone may relay authenticated evidence. No caller supplies policy
    /// booleans; each input is derived here before the adapter evaluates it.
    function settle(
        ChargeAuthorization calldata authorization,
        bytes calldata customerSignature,
        Tap13Receipt.Receipt calldata receipt,
        bytes calldata providerSignature
    ) external nonReentrant {
        if (consumedRequests[authorization.requestId] || consumedNonces[authorization.nonce]) revert AlreadyConsumed();
        if (price > balance || price > hardBudget - spent) revert HardBudgetExceeded();
        if (
            block.timestamp > authorization.validUntil || authorization.validUntil > refundAfter
                || authorization.validUntil == 0
        ) revert AuthorizationExpired();
        if (
            authorization.requestId == bytes32(0) || authorization.requestHash == bytes32(0)
                || receipt.requestId != authorization.requestId || receipt.requestHash != authorization.requestHash
                || receipt.bodyHash == bytes32(0)
        ) revert ReceiptBindingFailed();
        // Reported execution must occur before session expiry. Settlement may be
        // relayed in the locked window; no refund can race an in-window charge.
        if (
            receipt.timestamp > expiresAt || receipt.timestamp > authorization.validUntil
                || receipt.timestamp > block.timestamp
                || block.timestamp - receipt.timestamp > MAX_RECEIPT_SKEW
        ) revert ReceiptExpired();

        (address recovered, ECDSA.RecoverError error,) =
            ECDSA.tryRecover(authorizationDigest(authorization), customerSignature);
        uint8 inputs;
        if (authorization.serviceId == serviceId) inputs |= 1;
        if (receipt.ok && Tap13Receipt.verified(serviceContainer, providerSigner, receipt, providerSignature)) inputs |= 2;
        if (error == ECDSA.RecoverError.NoError && recovered == customer && price <= authorization.maxAmount) {
            inputs |= 4;
            if (authorization.overrideSoftLimit) inputs |= 32;
        }
        if (!refunded && block.timestamp < refundAfter) inputs |= 8;
        if (price <= softLimit && spent <= softLimit - price) inputs |= 16;

        if (!adapter.isAllowed(inputs)) revert PolicyDenied(inputs);
        consumedRequests[authorization.requestId] = true;
        consumedNonces[authorization.nonce] = true;
        balance -= price;
        spent += price;
        token.safeTransfer(provider, price);
        emit ChargeSettled(
            authorization.requestId, serviceId, provider, price, inputs, adapter.processor(), adapter.circuitId()
        );
    }

    function refund() external nonReentrant {
        if (msg.sender != customer) revert UnauthorizedCustomer();
        if (block.timestamp < refundAfter) revert RefundLocked();
        uint256 amount = balance;
        balance = 0;
        refunded = true;
        token.safeTransfer(customer, amount);
        emit BalanceRefunded(customer, amount);
    }
}
