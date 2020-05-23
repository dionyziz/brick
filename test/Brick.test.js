const truffleAssert = require('truffle-assertions')
const { offchainSign, hexToBytes, signState, signAutoIncrement } = require('../src/brick')
const { assertBalanceDiff } = require('./helpers')
const Brick = artifacts.require('Brick')

contract('Brick', (accounts) => {
    const alice = accounts[0]
    const bob = accounts[1]
    const n = 13
    const f = (n - 1) / 3
    const t = 2 * f + 1
    const eve = accounts[n + 3]
    const FEE = 20
    const watchtowers = []
    // mnemonic: attack guess know manual soap original panel cabbage firm horn whale party
    const alicePrivate = '0x1c56446a08c77d9fe6b47d94f81908c3346dc1230d7e48b3fccf97747c665f7b'
    const bobPrivate = '0x99fdca82537fb4815cd41215f370e19214d6d77b4705840a16bee5bf3bfa4e59'
    const evePrivate = '0xcc6cb8bf2030d7844113e19b5df953dafa505be01ef36677b1b0a1298fc9df1d'
    const watchtowersPrivates = [
        '0xcca2de8d9000d2d815b9e15864822a2624b033a6be7b9ddef1d011dbe3d46550',
        '0xf1cf1e1c8dc2aa1a4b8c91a8782188daf9829cad4565d6ae8fac50ceffa3bd1b',
        '0x22ef6c82a61002bb161fc55e839578cb1d24da126a70cb1d9d177614439fff95',
        '0x774d8af5c5b711396b5d365ea965b6264e372a263623cc02fc6a3d6aea226b04',
        '0xcd4c4e12f6a022d7ab9ac97f484a0b41d4e6b6d98c2e938fc7322485f7c6c3da',
        '0x313a1e791613d3a72e37629c9c590f062fba930d5f1e20dc45d6dcf9e63f7488',
        '0xdac0b5774f312f74e797bd0618ca088b7e1daeabdad440d11d15939660851c91',
        '0x38d2a19260bfbb29b5173f9518af66845f15da4f735cc379e791819d8036ad06',
        '0xe959232644d63a370a58b6d498e3b370b874fe3f0b9b64d3f4bc77cea8acb1b5',
        '0x158a5a2f76783c5cb5c4861ffe184f3f3ecdb09123b11570e158188e74c33e08',
        '0x6c34d32422fda973eb33a2f2a42bf184de33c37015665a16941359491dfefac5',
        '0xbcf8917442048005881b0046acce3d1e5fb7bac4dbd135cdd8fb46c3bb73a413',
        '0xd150663fcf4efe33f5eb627b802831b26207b92084c894440de30ebe78137695',
        '0x0bcaebd1fe5cd1b1181bce6b00c63e76ef9e7c4360297378e913218bbcc825be',
    ]
    const initialState = {
        aliceValue: 5,
        autoIncrement: 0
    }
    const state3 = {
        aliceValue: 1,
        autoIncrement: 3
    }
    const overdraftState = {
        aliceValue: 100,
        bobValue: 100,
        autoIncrement: 0
    }

    for (let i = 0; i < n; ++i) {
        watchtowers.push(accounts[i + 2])
    }

    const makeBrick = async () => {
        const brick = await Brick.new()
        await brick.aliceFund(bob, watchtowers, { value: FEE / 2 + 5 })
        return brick
    }

    const fundBob = (brick) =>
        brick.fundBob({ from: bob, value: FEE / 2 + 12 })

    const makeFundedBrick = async () => {
        const brick = await makeBrick()
        await fundBob(brick)

        for (let idx = 0; idx < n; ++idx) {
            await brick.fundWatchtower(idx, { from: watchtowers[idx], value: 5 })
        }
        return brick
    }

    const makeOpenBrick = async () => {
        const brick = await makeFundedBrick()
        await brick.open()
        return brick
    }

    it('is constructable', async () => {
        const brick = await makeBrick()

        assert.equal(await brick._alice(), alice)
        assert.equal(await brick._bob(), bob)
        for (let i = 0; i < n; ++i) {
            assert.equal(await brick._watchtowers(i), watchtowers[i])
        }
        assert.equal(await brick._f(), 4)
    })

    it('is fundable', async () => {
        const brick = await makeBrick()
        assert.equal(await brick._bobFunded(), false)
        await truffleAssert.reverts(brick.fundBob({ from: bob }), 'Bob must pay at least the fee')
        await truffleAssert.reverts(brick.fundWatchtower(0, { from: watchtowers[0] }), '', 'Watchtower cannot fund before Bob')
        await fundBob(brick)
        assert.equal(await brick._bobFunded(), true)
        const aliceValue = await brick._initialAliceValue()
        const bobValue = await brick._initialBobValue()
        assert.equal(aliceValue.toNumber(), 5)
        assert.equal(bobValue.toNumber(), 12)

        await truffleAssert.reverts(brick.fundWatchtower(5, { from: watchtowers[5] }), 'Watchtower must pay at least the collateral')

        assert.equal((await brick._collateral()).toNumber(), 5)

        for (let idx = 0; idx < n; ++idx) {
            assert.equal(await brick._watchtowerFunded(idx), false)
            await brick.fundWatchtower(idx, { from: watchtowers[idx], value: 5 })
            assert.equal(await brick._watchtowerFunded(idx), true)
        }
    })

    it('allows early withdrawals', async () => {
        let brick = await makeBrick()
        await truffleAssert.reverts(
            brick.withdrawBeforeOpen(0, { from: eve }),
            'Only the participants can withdraw'
        )
        await assertBalanceDiff(
            [{ account: alice, value: FEE / 2 + 5, paysForGas: true }],
            () => brick.withdrawBeforeOpen(0)
        )
        await truffleAssert.reverts(
            brick.withdrawBeforeOpen(0, { from: alice }),
            'Alice has already withdrawn'
        )
        await truffleAssert.reverts(
            brick.withdrawBeforeOpen(0, { from: bob }),
            'Bob has already withdrawn',
            'Bob should not be able to withdraw without depositing'
        )
        await truffleAssert.reverts(
            brick.withdrawBeforeOpen(0, { from: watchtowers[0] }),
            'This watchtower has already withdrawn',
            'A watchtower should not be able to withdraw without depositing'
        )

        brick = await makeBrick()
        await fundBob(brick)
        await assertBalanceDiff(
            [{ account: bob, value: FEE / 2 + 12, paysForGas: true }],
            () => brick.withdrawBeforeOpen(0, { from: bob })
        )
        await truffleAssert.reverts(
            brick.withdrawBeforeOpen(0, { from: bob }),
            'Bob has already withdrawn'
        )

        brick = await makeBrick()
        await fundBob(brick)
        await brick.fundWatchtower(3, { from: watchtowers[3], value: 5 })
        await brick.fundWatchtower(4, { from: watchtowers[4], value: 5 })
        await truffleAssert.reverts(
            brick.withdrawBeforeOpen(0, { from: watchtowers[0] }),
            'This watchtower has already withdrawn',
            'A watchtower should not be able to withdraw without depositing, even if other watchtowers have deposited'
        )
        await truffleAssert.reverts(
            brick.withdrawBeforeOpen(3, { from: watchtowers[0] }),
            'Only the participants can withdraw',
            'A watchtower should not be able to withdraw the money of other watchtowers'
        )
        await assertBalanceDiff(
            [{ account: watchtowers[3], value: 5, paysForGas: true }],
            () => brick.withdrawBeforeOpen(3, { from: watchtowers[3] })
        )
        await truffleAssert.reverts(
            brick.withdrawBeforeOpen(3, { from: watchtowers[3] }),
            'This watchtower has already withdrawn'
        )
        await assertBalanceDiff(
            [{ account: watchtowers[4], value: 5, paysForGas: true }],
            () => brick.withdrawBeforeOpen(4, { from: watchtowers[4] })
        )
        await truffleAssert.reverts(
            brick.withdrawBeforeOpen(4, { from: watchtowers[4] }),
            'This watchtower has already withdrawn'
        )
    })

    it('opens', async () => {
        const brick = await makeBrick()

        await truffleAssert.reverts(
            brick.open(), 'Invalid phase',
            'Bob must fund channel before opening'
        )
        await fundBob(brick)
        await truffleAssert.reverts(
            brick.open(),
            'watchtowers must fund the channel before opening'
        )
        await brick.fundWatchtower(0, { from: watchtowers[0], value: 5 })
        await brick.fundWatchtower(2, { from: watchtowers[2], value: 5 })
        await truffleAssert.reverts(
            brick.open(),
            'All watchtowers must fund the channel before opening'
        )

        for (let idx = 0; idx < n; ++idx) {
            if (idx != 0 && idx != 2) {
                await brick.fundWatchtower(idx, { from: watchtowers[idx], value: 5 })
            }
        }
        await brick.open()
    })

    it('closes optimistically', async () => {
        const brick = await makeFundedBrick()

        await truffleAssert.reverts(
            brick.optimisticAliceClose(5),
            '',
            'Should not close channel that is not open'
        )

        await brick.open()

        await truffleAssert.reverts(
            brick.optimisticBobClose({ from: bob }),
            'Bob cannot close on his own'
        )

        await truffleAssert.reverts(
            brick.optimisticAliceClose(226),
            'cannot close at a higher value than it began'
        )

        await brick.optimisticAliceClose(4)

        await assertBalanceDiff(
            [{
                account: alice,
                value: 4 + FEE / 2
            }, {
                account: bob,
                value: 13 + FEE / 2,
                paysForGas: true
            }, {
                account: watchtowers[0],
                value: 5
            }, {
                account: watchtowers[7],
                value: 5
            }],
            () => brick.optimisticBobClose({ from: bob })
        )
    })

    it('validates signatures', async () => {
        const brick = await makeOpenBrick()
        const PREFIX = "\x19Ethereum Signed Message:\n"
        const msg = '\x88' // 'hello'
        const msgHex = Buffer.from(msg, 'latin1').toString('hex')
        const msgHashHex = web3.utils.keccak256('0x' + msgHex)
        const msgHashBytes = hexToBytes(msgHashHex.slice(2))

        const prefixedMessage = PREFIX + msgHashBytes.length + msgHashBytes
        const prefixedMessageHex = Buffer.from(prefixedMessage, 'latin1').toString('hex')
        const prefixedMessageHash = web3.utils.keccak256('0x' + prefixedMessageHex)

        let { v, r, s } = offchainSign(msg, alicePrivate)

        assert.equal(
            await brick.checkSig.call(
                alice,
                prefixedMessageHash,
                { v, r, s }
            ),
            true
        )
        assert.equal(
            await brick.checkSig.call(
                alice,
                web3.utils.keccak256(msgHashBytes),
                { v, r, s }
            ),
            false
        )

        assert.equal(
            await brick.checkPrefixedSig.call(
                alice,
                msgHashHex,
                { v, r, s }
            ),
            true
        )
        assert.equal(
            await brick.checkPrefixedSig.call(
                alice,
                '0xa' + msgHashHex.slice(3),
                { v, r, s }
            ),
            false
        )
    })

    it('recognizes valid announcements', async () => {
        const brick = await makeOpenBrick()
        const encoded = hexToBytes(web3.eth.abi.encodeParameters(
            ['address', 'uint16'],
            [brick.address, 0]
        ).slice(2))
        const aliceSig = offchainSign(encoded, alicePrivate)
        const bobSig = offchainSign(encoded, bobPrivate)

        assert.equal(
            await brick.validAnnouncement.call(
                {
                    autoIncrement: 0,
                    aliceSig,
                    bobSig
                },
                {
                    from: watchtowers[0]
                }
            ),
            true
        )

        assert.equal(
            await brick.validAnnouncement.call(
                {
                    autoIncrement: 0,
                    aliceSig,
                    bobSig
                },
                {
                    from: watchtowers[1]
                }
            ),
            true
        )

        assert.equal(
            await brick.validAnnouncement.call(
                {
                    autoIncrement: 1,
                    aliceSig,
                    bobSig
                },
                {
                    from: watchtowers[0]
                }
            ),
            false
        )
    })

    it('detects pessimistic failure conditions', async () => {
        let brick = await makeFundedBrick()

        const invalidSig = {
            v: web3.utils.fromAscii('0'),
            r: web3.utils.fromAscii('0'),
            s: web3.utils.fromAscii('0')
        }

        await truffleAssert.reverts(
            brick.pessimisticClose(state3, invalidSig, [], { from: eve }),
            'Channel is not open'
        )

        brick = await makeOpenBrick()

        await truffleAssert.reverts(
            brick.pessimisticClose(state3, invalidSig, [], { from: eve }),
            'Only Alice or Bob'
        )

        await truffleAssert.reverts(
            brick.pessimisticClose(state3, invalidSig, []),
            'must close at latest state'
        )

        await truffleAssert.reverts(
            brick.pessimisticClose(overdraftState, invalidSig, []),
            'must conserve monetary value'
        )

        await truffleAssert.reverts(
            brick.pessimisticClose(initialState, invalidSig, []),
            'At least 2f+1 watchtower claims are needed'
        )

        let autoIncrement = 0, aliceSig = invalidSig, bobSig = invalidSig
        const announcement = {autoIncrement, aliceSig, bobSig}

        await truffleAssert.reverts(
            brick.watchtowerClaimState({ autoIncrement, aliceSig, bobSig }, 0, { from: watchtowers[0] }),
            'does not have valid signatures'
        )

        aliceSig = signAutoIncrement(brick.address, 0, alicePrivate)
        bobSig = signAutoIncrement(brick.address, 0, bobPrivate)

        await truffleAssert.reverts(
            brick.watchtowerClaimState({
                autoIncrement: 0,
                aliceSig,
                bobSig
            }, 0, { from: watchtowers[1] }),
            'This is not the watchtower claimed'
        )

        for (let i = 0; i < t; ++i) {
            await brick.watchtowerClaimState({
                autoIncrement: 0,
                aliceSig,
                bobSig
            }, i, { from: watchtowers[i] })
            if (i == 5) {
                await truffleAssert.reverts(
                    brick.watchtowerClaimState({
                        autoIncrement: 0,
                        aliceSig,
                        bobSig
                    }, i, { from: watchtowers[i] }),
                    'Each watchtower can only submit one pessimistic state'
                )
            }
        }
        await truffleAssert.reverts(
            brick.watchtowerClaimState({
                autoIncrement: 0,
                aliceSig,
                bobSig
            }, t, { from: watchtowers[t] }),
            'Watchtower race is complete'
        )
        aliceSig = signState(brick.address, state3, alicePrivate)
        await truffleAssert.reverts(
            brick.pessimisticClose(state3, aliceSig, [], { from: bob }),
            'Channel must close at latest state'
        )
    })

    it('closes pessimistically', async () => {
        let brick = await makeOpenBrick()
        let aliceSig = signAutoIncrement(brick.address, 3, alicePrivate),
            bobSig = signAutoIncrement(brick.address, 3, bobPrivate)

        const aliceStateGoodSig = signState(brick.address, state3, alicePrivate)
        for (let i = 0; i < t; ++i) {
            if (i == t - 1) {
                await truffleAssert.reverts(
                    brick.pessimisticClose(state3, aliceStateGoodSig, [], { from: bob }),
                    'At least 2f+1 watchtower claims are needed'
                )
            }
            await brick.watchtowerClaimState({
                autoIncrement: 3,
                aliceSig,
                bobSig
            }, i, { from: watchtowers[i] })
        }
        const aliceStateBadSig = signState(brick.address, {
            aliceValue: 2,
            autoIncrement: 3
        }, alicePrivate)
        const eveSig = signState(brick.address, state3, evePrivate)

        await truffleAssert.reverts(
            brick.pessimisticClose(state3, aliceStateBadSig, [], { from: bob }),
            'Counterparty must have signed closing state'
        )
        await truffleAssert.reverts(
            brick.pessimisticClose(state3, eveSig, [], { from: bob }),
            'Counterparty must have signed closing state'
        )
        await brick.pessimisticClose(state3, aliceStateGoodSig, [], { from: bob })

        brick = await makeOpenBrick()
        await truffleAssert.reverts(
            brick.watchtowerClaimState({
                autoIncrement: 3,
                aliceSig,
                bobSig
            }, 0, { from: watchtowers[0] }),
            '',
            'Must not accept signatures for a different contract instatnce'
        )

        const aliceSigs = [], bobSigs = []

        for (let i = 0; i <= 3; ++i) {
            aliceSigs.push(signAutoIncrement(brick.address, i, alicePrivate))
            bobSigs.push(signAutoIncrement(brick.address, i, bobPrivate))
        }

        for (let i = n - 1; i >= n - t; --i) {
            await brick.watchtowerClaimState({
                autoIncrement: i % 4,
                aliceSig: aliceSigs[i % 4],
                bobSig: bobSigs[i % 4]
            }, i, { from: watchtowers[i] })
        }

        const bobStateGoodSig = signState(brick.address, state3, bobPrivate)

        await brick.pessimisticClose(state3, bobStateGoodSig, [])
    })

    it('verifies fraud proofs', async () => {
        // TODO
    })
})
