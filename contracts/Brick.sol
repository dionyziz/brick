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
        uint16 autoIncrement;
    }
    struct ECSignature {
        uint8 v;
        bytes32 r;
        bytes32 s;
    }
    struct Announcement {
        uint16 autoIncrement;
        ECSignature aliceSig;
        ECSignature bobSig;
    }
    struct FraudProof {
        Announcement statePoint;
        ECSignature watchtowerSig;
        uint8 watchtowerIdx;
    }

    uint8 public _n;
    uint8 public _t;
    uint256 constant public FEE = 20 wei; // must be even
    uint8 public _f;
    address payable public _alice;
    address payable public _bob;
    address payable[] public _watchtowers;
    BrickPhase public _phase;
    ChannelState public _initialState;
    bool[] public _watchtowerFunded;
    uint256 public _collateral = 0;
    bool public _bobFunded = false;
    bool _aliceRecovered = false;
    bool _bobRecovered = false;

    Announcement[] _watchtowerLastClaim;
    Announcement _bestAnnouncement;
    bool[] _watchtowerClaimedClose;
    uint8 _numWatchtowerClaims = 0;
    uint16 _maxWatchtowerAutoIncrementClaim = 0;
    bool _aliceWantsClose = false;
    ChannelState _aliceClaimedClosingState;
    uint8 _numHonestClosingWatchtowers = 0;

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

    constructor(address payable bob, address payable[] memory watchtowers)
    public payable {
        // TODO: watchtower privacy
        // This requirement is needed to ensure watchtowers are not
        // held hostage. If this requirement is not needed, the contract
        // works even with n = 0.
        // assert(n > 7);
        // Floor
        _n = uint8(watchtowers.length);
        _f = (_n - 1) / 3;
        _t = 2*_f + 1;
        // assert(t <= n && t >= 2*_f + 1);

        // If Alice pays less than FEE / 2, other parties should refuse to use this contract
        // but the contract does not need to check this here.
        // require(msg.value >= FEE / 2, 'Alice must pay at least the fee');
        _alice = msg.sender;
        _initialState.aliceValue = msg.value - FEE / 2;
        _bob = bob;
        _watchtowers = watchtowers;
        for (uint8 i = 0; i < _n; ++i) {
            _watchtowerFunded.push(false);
            _watchtowerClaimedClose.push(false);
            _watchtowerLastClaim.push(Announcement(0, ECSignature(0, 0, 0), ECSignature(0, 0, 0)));
        }
    }

    function fundBob() external payable atPhase(BrickPhase.AliceFunded) {
        // todo: make channel updatable while it is open
        require(msg.value >= FEE / 2, 'Bob must pay at least the fee');
        _initialState.bobValue = msg.value - FEE / 2;
        _bobFunded = true;
        // TODO: Check that ceil here is incentive-compatible for watchtower hostage situation
        if (_f > 0) {
            _collateral = divceil(_initialState.aliceValue + _initialState.bobValue, _f);
        }
        _phase = BrickPhase.BobFunded;
    }

    function fundWatchtower(uint8 idx)
    external payable atPhase(BrickPhase.BobFunded) {
        require(msg.value >= _collateral, 'Watchtower must pay at least the collateral');
        _watchtowerFunded[idx] = true;
    }

    function withdrawBeforeOpen(uint8 idx) external {
        uint256 amount;

        require(_phase == BrickPhase.AliceFunded ||
                _phase == BrickPhase.BobFunded ||
                _phase == BrickPhase.Cancelled,
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
        for (uint8 idx = 0; idx < _n; ++idx) {
            require(_watchtowerFunded[idx], 'All watchtowers must fund the channel before opening it');
        }
        _phase = BrickPhase.Open;
    }

    function optimisticAliceClose(ChannelState memory closingState)
    public openOnly aliceOnly {
        // Alice should stop using the channel off-chain once this
        // function is called.
        require(closingState.aliceValue + closingState.bobValue <=
                _initialState.aliceValue + _initialState.bobValue, 'Channel cannot close at a higher value than it began at');
        // Ensure Alice doesn't later change her mind about the value
        // in a malicious attempt to frontrun bob's optimisticBobClose()
        require(!_aliceWantsClose, 'Alice can only decide to close with one state');
        _aliceWantsClose = true;
        _aliceClaimedClosingState = closingState;
    }

    function optimisticBobClose()
    public openOnly bobOnly {
        require(_aliceWantsClose, 'Bob cannot close on his own volition');

        optimisticClose(_aliceClaimedClosingState);
    }

    function optimisticClose(ChannelState memory closingState)
    internal openOnly {
        _phase = BrickPhase.Closed;
        _alice.transfer(closingState.aliceValue + FEE / 2);
        _bob.transfer(closingState.bobValue + FEE / 2);

        for (uint256 idx = 0; idx < _n; ++idx) {
            _watchtowers[idx].transfer(_collateral);
        }
    }

    function watchtowerClaimState(Announcement memory announcement, uint256 idx)
    public openOnly {
        require(validAnnouncement(announcement), 'Announcement does not have valid signatures by Alice and Bob');
        require(msg.sender == _watchtowers[idx], 'This is not the watchtower claimed');
        require(!_watchtowerClaimedClose[idx], 'Each watchtower can only submit one pessimistic state');
        _watchtowerLastClaim[idx] = announcement;
        _watchtowerClaimedClose[idx] = true;
        ++_numWatchtowerClaims;

        if (announcement.autoIncrement > _maxWatchtowerAutoIncrementClaim) {
            _maxWatchtowerAutoIncrementClaim = announcement.autoIncrement;
            _bestAnnouncement = announcement;
        }
    }

    function pessimisticClose(ChannelState memory closingState, ECSignature memory counterpartySig, FraudProof[] memory proofs)
    public openOnly {
        require(msg.sender == _alice || msg.sender == _bob, 'Only Alice or Bob can pessimistically close the channel');
        require(_bestAnnouncement.autoIncrement == closingState.autoIncrement, 'Channel must close at latest state');
        require(closingState.aliceValue + closingState.bobValue <=
                _initialState.aliceValue + _initialState.bobValue, 'Channel must conserve monetary value');
        require(_numWatchtowerClaims >= _t, 'At least 2f+1 watchtower claims are needed for pessimistic close');
        bytes32 plaintext = keccak256(abi.encode(address(this), closingState));
        require(checkPrefixedSig(counterparty(msg.sender), plaintext, counterpartySig), 'Counterparty must have signed closing state');

        for (uint256 i = 0; i < proofs.length; ++i) {
            uint256 idx = proofs[i].watchtowerIdx;
            require(validFraudProof(proofs[i]), 'Invalid fraud proof');
            // Ensure there's at most one fraud proof per watchtower
            require(_watchtowerFunded[idx], 'Duplicate fraud proof');
            _watchtowerFunded[idx] = false;
        }

        _numHonestClosingWatchtowers = _n - uint8(proofs.length);
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

    function watchtowerRedeemCollateral(uint256 idx)
    external atPhase(BrickPhase.Closed) {
        require(msg.sender == _watchtowers[idx], 'This is not the watchtower claimed');
        require(_watchtowerFunded[idx], 'Malicious watchtower tried to redeem collateral; or double collateral redeem');

        _watchtowerFunded[idx] = false;
        _watchtowers[idx].transfer(_collateral + FEE / _numHonestClosingWatchtowers);
    }

    function checkSig(address pk, bytes32 plaintext, ECSignature memory sig)
    public pure returns(bool) {
        return ecrecover(plaintext, sig.v, sig.r, sig.s) == pk;
    }

    function checkPrefixedSig(address pk, bytes32 message, ECSignature memory sig)
    public pure returns(bool) {
        bytes32 prefixedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", message));

        return ecrecover(prefixedHash, sig.v, sig.r, sig.s) == pk;
    }

    function validAnnouncement(Announcement memory announcement)
    internal view returns(bool) {
        bytes32 plaintext = keccak256(abi.encode(address(this), announcement.autoIncrement));

        return checkPrefixedSig(_alice, plaintext, announcement.aliceSig) &&
               checkPrefixedSig(_bob, plaintext, announcement.bobSig);
    }

    function counterparty(address party)
    internal view returns (address payable) {
        if (party == _alice) {
            return _bob;
        }
        return _alice;
    }

    function staleClaim(FraudProof memory proof)
    internal view returns (bool) {
        uint256 watchtowerIdx = proof.watchtowerIdx;

        return proof.statePoint.autoIncrement >
               _watchtowerLastClaim[watchtowerIdx].autoIncrement;
    }

    function validFraudProof(FraudProof memory proof)
    internal view returns (bool) {
        return checkPrefixedSig(
            _watchtowers[proof.watchtowerIdx],
            keccak256(abi.encode(address(this), proof.statePoint.autoIncrement)),
            proof.watchtowerSig
        ) && staleClaim(proof);
    }

    function divceil(uint a, uint m)
    internal pure returns (uint) {
        return (a + m - 1) / m;
    }
}
