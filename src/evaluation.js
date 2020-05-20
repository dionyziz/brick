const EUR_IN_ETH = 195.37

module.exports = async (callback) => {
    try {
        console.log('Retrieving accounts')
        const accounts = await web3.eth.getAccounts()
        const Brick = artifacts.require('Brick')

        const alice = accounts[0]
        const bob = accounts[1]
        const n = 13
        const eve = accounts[n + 3]
        const FEE = 20
        const watchtowers = []

        for (let i = 0; i < n; ++i) {
            watchtowers.push(accounts[i + 2])
        }

        let openGas = 0

        console.log('Constructing brick')
        const brick = await Brick.new(bob, watchtowers, { value: FEE / 2 + 5 })
        console.log('Getting receipt')
        const receipt = await web3.eth.getTransactionReceipt(brick.transactionHash)
        console.log('Calculating gas for construction')
        const aliceFundGas = web3.utils.toBN(receipt.gasUsed)
        console.log('Gas for Alice fund: ', aliceFundGas.toString())

        let tx = await brick.fundBob({ from: bob, value: FEE / 2 + 12 })
        const bobFundGas = web3.utils.toBN(tx.receipt.gasUsed)
        console.log('Gas for Bob fund: ', bobFundGas.toString())

        let watchtowersGas = web3.utils.toBN(0)
        for (let idx = 0; idx < n; ++idx) {
            console.log('Watchtower ', idx, ' funding')
            tx = await brick.fundWatchtower(idx, { from: watchtowers[idx], value: 5 })
            watchtowersGas = watchtowersGas.add(web3.utils.toBN(tx.receipt.gasUsed))
        }
        console.log('Gas for watchtowers: ', watchtowersGas.toNumber())

        const totalGas = aliceFundGas.add(bobFundGas).add(watchtowersGas)
        console.log('Total gas: ', totalGas.toString())
        const localGasPrice = web3.utils.toBN(await web3.eth.getGasPrice())
        const medianGasPrice = web3.utils.toBN(web3.utils.toWei('35', 'gwei'))
        console.log('Local gas price: ', localGasPrice.toString())
        console.log('Median gas price: ', medianGasPrice.toString())
        const localGasCostWei = totalGas.mul(localGasPrice)
        const medianGasCostWei = totalGas.mul(medianGasPrice)

        console.log('Local gas cost in wei: ', localGasCostWei.toString())
        console.log('Median gas cost in wei: ', medianGasCostWei.toString())
        const localGasCostETH = web3.utils.fromWei(localGasCostWei, 'ether')
        const medianGasCostETH = web3.utils.fromWei(medianGasCostWei, 'ether')
        console.log('Total gas cost in ether (local price): ', localGasCostETH, 'ETH')
        console.log('Total gas cost in ether (median price): ', medianGasCostETH, 'ETH')
        const localGasCostEUR = localGasCostETH * EUR_IN_ETH
        const medianGasCostEUR = medianGasCostETH * EUR_IN_ETH
        console.log('Total gas cost in EUR (local price): ', localGasCostEUR.toFixed(2), '€')
        console.log('Total gas cost in EUR (median price): ', medianGasCostEUR.toFixed(2), '€')

        callback()
    }
    catch (err) {
        callback(err)
    }
}
