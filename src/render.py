import json
import matplotlib.pyplot as plt
from matplotlib import rc

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

fig = plt.figure()
fig.set_size_inches(6.2, 6.2)
plt.ylim(0.0, 20.0)

plt.plot(range(len(data['open'])), data['open'], label='Cost of opening')
plt.plot(range(len(data['optimisticClose'])), data['optimisticClose'], label='Cost of optimistic close')

plt.title('Gas cost of a Brick channel')
plt.ylabel('EUR')
plt.xlabel('Number $n$ of watchtower participants')
plt.legend()
# plt.axis([0, len(data['open']), 0, 20])

plt.show()
