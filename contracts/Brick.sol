/*
SPDX-License-Identifier: MIT
*/

pragma solidity >=0.5.16;
pragma experimental ABIEncoderV2;

contract Brick {
    enum BrickPhase {
        AliceFunded, BobFunded,
        Open, Cancelled, Closed
    }
    struct ChannelState {
        uint256 aliceValue;
        uint256 bobValue;
        uint256 autoIncrement;
    }
    struct ECSignature {
        uint8 v;
        bytes32 r;
        bytes32 s;
    }
    struct StatePoint {
        uint256 autoIncrement;
        ECSignature aliceSig;
        ECSignature bobSig;
    }
    struct FraudProof {
        StatePoint statePoint;
        ECSignature watchtowerSig;
        uint256 watchtowerIdx;
    }

    uint256 constant public n = 13;
    uint256 constant public t = 10;
    uint256 constant public FEE = 20 wei; // must be even
    uint256 public _f;
    address payable public _alice;
    address payable public _bob;
    address payable[n] public _watchtowers;
    BrickPhase public _phase;
    ChannelState public _initialState;
    bool[n] public _watchtowerFunded;
    uint256 public _collateral = 0;
    bool public _bobFunded = false;
    bool _aliceRecovered = false;
    bool _bobRecovered = false;

    StatePoint[n] _watchtowerLastClaim;
    StatePoint _bestClaimedState;
    bool[n] _watchtowerClaimedClose;
    uint256 _numWatchtowerClaims = 0;
    uint256 _maxWatchtowerAutoIncrementClaim = 0;
    bool _aliceWantsClose = false;
    ChannelState _aliceClaimedClosingState;
    uint256 _numHonestClosingWatchtowers = 0;

    modifier atPhase(BrickPhase phase) {
        require(_phase == phase, 'Invalid phase');
        _;
    }

    modifier aliceOnly() {
        require(msg.sender == _alice, 'Only Alice is allowed to call that');
        _;
    }

    modifier bobOnly() {
        require(msg.sender == _bob, 'Only Bob is allowed to call that');
        _;
    }

    modifier openOnly() {
        require(_phase == BrickPhase.Open, 'Channel is not open');
        _;
    }

    constructor(address payable bob, address payable[n] memory watchtowers) public payable {
        // TODO: watchtower privacy
        // This requirement is needed to ensure watchtowers are not
        // held hostage. If this requirement is not needed, the contract
        // works even with n = 0.
        assert(n > 7);
        // Floor
        _f = (n - 1) / 3;
        assert(t <= n && t >= 2*_f + 1);

        require(msg.value >= FEE / 2, 'Alice must pay at least the fee');
        _alice = msg.sender;
        _initialState.aliceValue = msg.value - FEE / 2;
        _bob = bob;
        _watchtowers = watchtowers;
    }

    function fundBob() external payable atPhase(BrickPhase.AliceFunded) bobOnly {
        // todo: make channel updatable while it is open
        require(!_bobFunded, 'Bob has already funded the channel');
        require(msg.value >= FEE / 2, 'Bob must pay at least the fee');
        _initialState.bobValue = msg.value - FEE / 2;
        _bobFunded = true;
        // TODO: Check that ceil here is incentive-compatible for watchtower hostage situation
        _collateral = divceil(_initialState.aliceValue + _initialState.bobValue, _f);
        _phase = BrickPhase.BobFunded;
    }

    function fundWatchtower(uint256 idx) external payable atPhase(BrickPhase.BobFunded) {
        require(msg.value >= _collateral, 'Watchtower must pay at least the collateral');
        _watchtowerFunded[idx] = true;
    }

    function withdrawBeforeOpen(uint256 idx) external {
        uint256 amount;

        require(_phase == BrickPhase.AliceFunded
             || _phase == BrickPhase.BobFunded
             || _phase == BrickPhase.Cancelled,
                'Withdrawals are only allowed early');

        if (msg.sender == _alice) {
            require(!_aliceRecovered, 'Alice has already withdrawn');
            _aliceRecovered = true;
            amount = _initialState.aliceValue + FEE / 2;
        }
        else if (msg.sender == _bob) {
            require(_bobFunded, 'Bob has already withdrawn');
            _bobFunded = false;
            amount = _initialState.bobValue + FEE / 2;
        }
        else if (msg.sender == _watchtowers[idx]) {
            require(_watchtowerFunded[idx], 'This watchtower has already withdrawn');
            _watchtowerFunded[idx] = false;
            amount = _collateral;
        }
        else {
            revert('Only the participants can withdraw');
        }

        _phase = BrickPhase.Cancelled;
        msg.sender.transfer(amount);
    }

    function open() external atPhase(BrickPhase.BobFunded) {
        // TODO: if a watchtower has not funded for a while,
        // allow the channel to open without them
        for (uint256 idx = 0; idx < n; ++idx) {
            require(_watchtowerFunded[idx], 'All watchtowers must fund the channel before opening it');
        }
        _phase = BrickPhase.Open;
    }

    function optimisticAliceClose(ChannelState memory closingState) public openOnly aliceOnly {
        // Alice should stop using the channel off-chain once this
        // function is called.
        require(closingState.aliceValue + closingState.bobValue <=
                _initialState.aliceValue + _initialState.bobValue, 'Channel cannot close at a higher value than it began at');
        _aliceWantsClose = true;
        _aliceClaimedClosingState = closingState;
    }

    function optimisticBobClose(ChannelState memory bobClaimedClosingState) public openOnly bobOnly {
        require(_aliceClaimedClosingState.aliceValue == bobClaimedClosingState.aliceValue, 'Bob must agree on Alice value on optimistic close');
        require(_aliceClaimedClosingState.bobValue == bobClaimedClosingState.bobValue, 'Bob must agree on Alice value on optimistic close');
        require(_aliceWantsClose);

        optimisticClose(_aliceClaimedClosingState);
    }

    function optimisticClose(ChannelState memory closingState) internal openOnly {
        _phase = BrickPhase.Closed;
        _alice.transfer(closingState.aliceValue + FEE / 2);
        _bob.transfer(closingState.bobValue + FEE / 2);

        for (uint256 idx = 0; idx < n; ++idx) {
            _watchtowers[idx].transfer(_collateral);
        }
    }

    function watchtowerClaimState(StatePoint memory claimedLastState, uint256 idx) public openOnly {
        require(validState(claimedLastState), 'Watchtower claim was invalid');
        require(msg.sender == _watchtowers[idx], 'This is not the watchtower claimed');
        require(!_watchtowerClaimedClose[idx], 'Each watchtower can only submit one pessimistic state');
        _watchtowerLastClaim[idx] = claimedLastState;
        _watchtowerClaimedClose[idx] = true;
        ++_numWatchtowerClaims;

        if (claimedLastState.autoIncrement > _maxWatchtowerAutoIncrementClaim) {
            _maxWatchtowerAutoIncrementClaim = claimedLastState.autoIncrement;
            _bestClaimedState = claimedLastState;
        }
    }

    function pessimisticClose(ChannelState memory closingState, ECSignature memory counterpartySig, FraudProof[] memory proofs)
        public openOnly {
        require(msg.sender == _alice || msg.sender == _bob, 'Only Alice or bob can pessimistically close the channel');
        require(_bestClaimedState.autoIncrement == closingState.autoIncrement, 'Channel must close at latest state');
        require(_numWatchtowerClaims >= 2*_f + 1, 'At least 2f+1 watchtower claims are needed for pessimistic close');
        require(checkSig(counterparty(msg.sender), keccak256(abi.encode(address(this), closingState)), counterpartySig));

        for (uint256 i = 0; i < proofs.length; ++i) {
            uint256 idx = proofs[i].watchtowerIdx;
            require(validFraudProof(proofs[i]), 'Invalid fraud proof');
            // Ensure there's at most one fraud proof per watchtower
            require(_watchtowerFunded[idx], 'Duplicate fraud proof');
            _watchtowerFunded[idx] = false;
        }

        _numHonestClosingWatchtowers = n - proofs.length;
        _phase = BrickPhase.Closed;

        if (proofs.length <= _f) {
            _alice.transfer(closingState.aliceValue);
            _bob.transfer(closingState.bobValue);
        }
        else {
            counterparty(msg.sender).transfer(
                closingState.aliceValue + closingState.bobValue
            );
        }
        msg.sender.transfer(_collateral * proofs.length);
    }

    function watchtowerRedeemCollateral(uint256 idx) external atPhase(BrickPhase.Closed) {
        require(msg.sender == _watchtowers[idx], 'This is not the watchtower claimed');
        require(_watchtowerFunded[idx], 'Malicious watchtower tried to redeem collateral; or honest watchtower tried to redeem collateral twice');

        _watchtowerFunded[idx] = false;
        _watchtowers[idx].transfer(_collateral + FEE / _numHonestClosingWatchtowers);
    }

    function checkSig(address pk, bytes32 plaintext, ECSignature memory sig) internal pure returns(bool) {
        return ecrecover(plaintext, sig.v, sig.r, sig.s) == pk;
    }

    function validState(StatePoint memory statePoint) internal view returns(bool) {
        bytes32 plaintext = keccak256(abi.encode(address(this), statePoint.autoIncrement));

        require(
            checkSig(
                _alice,
                plaintext,
                statePoint.aliceSig
            ) &&
            checkSig(
                _bob,
                plaintext,
                statePoint.bobSig
            ),
            'Channel state does not have valid signatures by Alice and Bob'
        );
    }

    function counterparty(address party) internal view returns (address payable) {
        if (party == _alice) {
            return _bob;
        }
        return _alice;
    }

    function staleClaim(FraudProof memory proof) internal view returns (bool) {
        uint256 watchtowerIdx = proof.watchtowerIdx;

        return proof.statePoint.autoIncrement >
               _watchtowerLastClaim[watchtowerIdx].autoIncrement;
    }

    function validFraudProof(FraudProof memory proof) internal view returns (bool) {
        return checkSig(
            _watchtowers[proof.watchtowerIdx],
            keccak256(abi.encode(address(this), proof.statePoint.autoIncrement)),
            proof.watchtowerSig
        ) && staleClaim(proof);
    }

    function divceil(uint a, uint m) internal pure returns (uint) {
        return (a + m - 1) / m;
    }
}
