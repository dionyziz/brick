const EUR_IN_ETH = 195.37
const winston = require('winston')

winston.configure({
    format: winston.format.simple(),
    transports: [
        new winston.transports.Console({ json: false, colorize: true })
    ]
})

async function gasInEUR(gas) {
    const localGasPrice = web3.utils.toBN(await web3.eth.getGasPrice())
    // const medianGasPrice = web3.utils.toBN(web3.utils.toWei('35', 'gwei'))
    winston.info(`Local gas price: ${localGasPrice.toString()}`)
    // winston.info(`Median gas price: ${medianGasPrice.toString()}`)
    const localGasCostWei = gas.mul(localGasPrice)
    // const medianGasCostWei = openGas.mul(medianGasPrice)

    winston.info(`Local gas cost in wei: ${localGasCostWei.toString()}`)
    // winston.info(`Median gas cost in wei: ${medianGasCostWei.toString()}`)
    const localGasCostETH = web3.utils.fromWei(localGasCostWei, 'ether')
    // const medianGasCostETH = web3.utils.fromWei(medianGasCostWei, 'ether')
    winston.info(`Total gas cost in ether (local price): ${localGasCostETH} ETH`)
    // winston.info(`Total gas cost in ether (median price): ${medianGasCostETH} ETH`)
    const localGasCostEUR = localGasCostETH * EUR_IN_ETH
    // const medianGasCostEUR = medianGasCostETH * EUR_IN_ETH
    winston.info(`Total gas cost in EUR (local price): ${localGasCostEUR.toFixed(2)} €`)
    // winston.info(`Total gas cost in EUR (median price): ${medianGasCostEUR.toFixed(2)} €`)

    return localGasCostEUR
}

async function gasCost(n) {
    winston.info(`n = ${n}`)
    const { signAutoIncrement, signState } = require('../src/brick')

    const f = Math.floor((n - 1) / 3)
    winston.info(`f = ${f}`)
    const t = Math.min(2 * f + 1, n)
    winston.info(`t = ${t}`)

    winston.info('Retrieving accounts')
    const accounts = await web3.eth.getAccounts()
    const Brick = artifacts.require('Brick')

    const alice = accounts[0]
    const bob = accounts[1]
    const eve = accounts[n + 3]
    const FEE = 20
    const watchtowers = []

    const alicePrivate = '0x1c56446a08c77d9fe6b47d94f81908c3346dc1230d7e48b3fccf97747c665f7b'
    const bobPrivate = '0x99fdca82537fb4815cd41215f370e19214d6d77b4705840a16bee5bf3bfa4e59'

    for (let i = 0; i < n; ++i) {
        watchtowers.push(accounts[i + 2])
    }

    winston.info('Constructing brick')
    let brick = await Brick.new(bob, watchtowers, { value: FEE / 2 + 5 })

    // winston.info('Getting receipt')
    const receipt = await web3.eth.getTransactionReceipt(brick.transactionHash)
    winston.info('Calculating gas for construction')
    const aliceFundGas = web3.utils.toBN(receipt.gasUsed)
    winston.info(`Gas for Alice fund: ${aliceFundGas.toString()}`)

    let tx = await brick.fundBob({ from: bob, value: FEE / 2 + 12 })
    const bobFundGas = web3.utils.toBN(tx.receipt.gasUsed)
    winston.info(`Gas for Bob fund: ${bobFundGas.toString()}`)

    let watchtowersGas = web3.utils.toBN(0)
    for (let idx = 0; idx < n; ++idx) {
        winston.info(`Watchtower ${idx} funding`)
        tx = await brick.fundWatchtower(idx, { from: watchtowers[idx], value: 50 })
        watchtowersGas = watchtowersGas.add(web3.utils.toBN(tx.receipt.gasUsed))
        winston.info(`Gas for ${idx}th watchtower ${tx.receipt.gasUsed.toString()}`)
    }
    winston.info(`Gas for watchtowers: ${watchtowersGas.toNumber()}`)
    tx = await brick.open()
    const openCallGas = web3.utils.toBN(tx.receipt.gasUsed)
    winston.info(`Gas for open call: ${openCallGas.toNumber()}`)
    const openGas = aliceFundGas.add(bobFundGas).add(watchtowersGas).add(openCallGas)

    tx = await brick.optimisticAliceClose({
        aliceValue: 5, bobValue: 12, autoIncrement: 0
    })
    const aliceCloseGas = web3.utils.toBN(tx.receipt.gasUsed)
    tx = await brick.optimisticBobClose({ from: bob })
    const bobCloseGas = web3.utils.toBN(tx.receipt.gasUsed)
    const optimisticCloseGas = aliceCloseGas.add(bobCloseGas)
    winston.info(`Gas used for optimistic close: ${optimisticCloseGas}`)

    winston.info(`Total open gas: ${openGas.toString()}`)
    const openGasEUR = await gasInEUR(openGas)
    winston.info(`Total open gas cost (EUR): ${openGasEUR}`)

    const optimisticCloseGasEUR = await gasInEUR(optimisticCloseGas)

    brick = await Brick.new(bob, watchtowers, { value: FEE / 2 + 5 })
    await brick.fundBob({ from: bob, value: FEE / 2 + 12 })
    for (let idx = 0; idx < n; ++idx) {
        await brick.fundWatchtower(idx, { from: watchtowers[idx], value: 50 })
    }
    await brick.open()

    let aliceSig = signAutoIncrement(brick.address, 3, alicePrivate),
        bobSig = signAutoIncrement(brick.address, 3, bobPrivate)

    let watchtowerClaimsGas = web3.utils.toBN(0)
    for (let i = 0; i < t; ++i) {
        winston.info(`Watchtower ${i} claiming state`)
        tx = await brick.watchtowerClaimState({
            autoIncrement: 3,
            aliceSig,
            bobSig
        }, i, { from: watchtowers[i] })
        watchtowerClaimsGas = watchtowerClaimsGas.add(web3.utils.toBN(tx.receipt.gasUsed))
    }
    winston.info(`Gas used by watchtower claims in pessimistic close: ${watchtowerClaimsGas}`)
    const state3 = {
        aliceValue: 10,
        bobValue: 7,
        autoIncrement: 3
    }
    aliceSig = signState(brick.address, state3, alicePrivate)
    tx = await brick.pessimisticClose(state3, aliceSig, [], { from: bob })
    const closeGas = web3.utils.toBN(tx.receipt.gasUsed)
    winston.info(`Gas used for final pessimistic close() call: ${closeGas}`)
    const pessimisticCloseGas = watchtowerClaimsGas.add(closeGas)
    const pessimisticCloseGasEUR = await gasInEUR(pessimisticCloseGas)
    winston.info(`Total pessimistic close gas (EUR): ${pessimisticCloseGasEUR} €`)

    return {
        open: openGasEUR.toFixed(2),
        optimisticClose: optimisticCloseGasEUR.toFixed(2),
        pessimisticClose: pessimisticCloseGasEUR.toFixed(2)
    }
}

module.exports = async (callback) => {
    try {
        const Promise = require('bluebird')
        const fs = Promise.promisifyAll(require('fs'))
        const graphs = {
            open: [],
            optimisticClose: [],
            pessimisticClose: []
        }

        for (let n = 3; n <= 30; ++n) {
            const cost = await gasCost(n)
            graphs.open.push(cost.open)
            graphs.optimisticClose.push(cost.optimisticClose)
            graphs.pessimisticClose.push(cost.pessimisticClose)
        }
        await fs.writeFileAsync('data.json', JSON.stringify(graphs))

        callback()
    }
    catch (err) {
        callback(err)
    }
}
