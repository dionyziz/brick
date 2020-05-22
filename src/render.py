import json
import matplotlib.pyplot as plt
from matplotlib import rc

EUR_IN_ETH = 195.37

# rc('font',**{'family':'sans-serif','sans-serif':['Helvetica']})
plt.rcParams['text.latex.preamble'] = [r"\usepackage{lmodern}"]
## for Palatino and other serif fonts use:
#rc('font',**{'family':'serif','serif':['Palatino']})
rc('text', usetex=True)
rc(
    'font',
    family='serif',
    serif=['Computer Modern Roman'],
    monospace=['Computer Modern Typewriter'],
    size=14
)

with open('data.json') as f:
    data = json.load(f)

data['open'] = list(map(lambda x: float(x), data['open']))
data['optimisticClose'] = list(map(lambda x: float(x), data['optimisticClose']))
data['pessimisticClose'] = list(map(lambda x: float(x), data['pessimisticClose']))

fig, ax = plt.subplots(constrained_layout=True)
fig.set_size_inches(6.2, 6.2)
ax.set_ylim(0.0, 24.0)

ax.plot(range(3, 3 + len(data['open'])), data['open'], 'r-o', label='Cost of opening')
ax.plot(range(3, 3 + len(data['pessimisticClose'])), data['pessimisticClose'], 'g-o', label='Cost of pessimistic close')
ax.plot(range(3, 3 + len(data['optimisticClose'])), data['optimisticClose'], 'b-o', label='Cost of optimistic close')

ax.axvline(x=13, label='Recommended $n$', color='orange', linestyle='--')

ax.set_title('Gas cost of a Brick channel')
ax.set_ylabel('EUR')

def eur2eth(eur):
    eth = eur / EUR_IN_ETH
    return eth

def eth2eur(eth):
    eur = EUR_IN_ETH * eth
    return eur

secax = ax.secondary_yaxis('right', functions=(eur2eth, eth2eur))
secax.set_ylabel('Ether')
ax.set_xlabel('Number $n$ of watchtower participants')
plt.legend()
# plt.axis([0, len(data['open']), 0, 20])

plt.show()

fig.savefig("figures/gas-cost.pdf", bbox_inches='tight')
