const RPC_URL = 'https://ethereum-rpc.publicnode.com';

// 1 ETH = 10^18 wei (ethereum.org "Denominations of ether")
const WEI_PER_ETH = 10n ** 18n;
const ETH_DECIMALS = 18;

const addressInput = document.getElementById('address-input');
const searchButton = document.getElementById('search-button');
const resultArea = document.getElementById('result');

// JSON-RPC 2.0 요청을 보내고 result 값만 돌려준다. (다른 메서드에서도 재사용)
async function rpcRequest(method, params) {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: method, params: params, id: 1 }),
  });
  const data = await response.json();
  return data.result;
}

// wei 단위 QUANTITY(hex 문자열)를 ETH 문자열로 변환한다.
// 잔액은 2^53 - 1을 넘을 수 있어 Number 대신 BigInt로 정수 연산만 한다.
function formatEther(hexWei) {
  const wei = BigInt(hexWei);
  const whole = wei / WEI_PER_ETH;
  const fraction = wei % WEI_PER_ETH;

  // 소수부를 18자리로 맞춘 뒤(앞쪽 0 보존) 끝의 0만 제거한다. 반올림하지 않는다.
  const fractionText = fraction.toString().padStart(ETH_DECIMALS, '0').replace(/0+$/, '');
  return fractionText ? `${whole}.${fractionText}` : whole.toString();
}

async function showBalance() {
  const address = addressInput.value.trim();
  const hexBalance = await rpcRequest('eth_getBalance', [address, 'latest']);
  resultArea.textContent = `잔액: ${formatEther(hexBalance)} ETH`;
}

searchButton.addEventListener('click', showBalance);
addressInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') showBalance();
});
