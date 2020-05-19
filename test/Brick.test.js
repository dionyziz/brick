/*
const assert = require('assert')
const ganache = require('ganache-cli')
const Web3 = reuqire('web3')
const web3 = new Web3(ganache.provider())
const json = require('./../build/contracts/Brick.json')
*/
const truffleAssert = require('truffle-assertions')

const Brick = artifacts.require('Brick')

contract('Brick', (accounts) => {
    const alice = accounts[0]
    const bob = accounts[1]
    const n = 13
    const FEE = 20
    const watchtowers = []

    for (let i = 0; i < n; ++i) {
        watchtowers.push(accounts[i + 2])
    }

    it('is constructable', async () => {
        await truffleAssert.reverts(Brick.new(bob, watchtowers), 'Alice must pay at least the fee')
        const brick = await Brick.new(bob, watchtowers, { value: FEE / 2 })

        assert.equal(await brick._alice(), alice)
        assert.equal(await brick._bob(), bob)
        for (let i = 0; i < n; ++i) {
            assert.equal(await brick._watchtowers(i), watchtowers[i])
        }
    })

    it('is fundable', async () => {
        const brick = await Brick.new(bob, watchtowers, { value: FEE / 2 })
        assert.equal(await brick._bobFunded(), false)
        await truffleAssert.reverts(brick.fundBob({ from: bob }), 'Bob must pay at least the fee')
        await brick.fundBob({ from: bob, value: FEE / 2 })
        assert.equal(await brick._bobFunded(), true)
    })
})
