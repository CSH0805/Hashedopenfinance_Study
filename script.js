const RPC_URL = 'https://ethereum-rpc.publicnode.com';
const REQUEST_TIMEOUT_MS = 10000;

// 1 ETH = 10^18 wei (ethereum.org "Denominations of ether")
const WEI_PER_ETH = 10n ** 18n;
const ETH_DECIMALS = 18;

const addressInput = document.getElementById('address-input');
const searchButton = document.getElementById('search-button');
const statusArea = document.getElementById('status');
const resultArea = document.getElementById('result');
const errorArea = document.getElementById('error');
const blockNumberArea = document.getElementById('block-number');

let isLoading = false;

// rpcRequest가 던지는 오류. kind로 실패 원인을 구분한다.
class RpcError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

// JSON-RPC 2.0 요청을 보내고 result 값만 돌려준다. (다른 메서드에서도 재사용)
// 실패하면 원인별로 RpcError를 던진다.
async function rpcRequest(method, params) {
  // 일정 시간 안에 응답(본문 포함)이 끝나지 않으면 요청을 중단한다.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    let response;
    try {
      response = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: method, params: params, id: 1 }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new RpcError('timeout', `응답이 ${REQUEST_TIMEOUT_MS / 1000}초 동안 없어 요청을 중단했습니다.`);
      }
      // fetch는 오프라인, DNS 실패, CORS 차단 등 응답 자체를 받지 못하면 TypeError로 실패한다.
      throw new RpcError('network', '네트워크 연결에 실패했습니다. 인터넷 연결을 확인해 주세요.');
    }

    // fetch는 4xx/5xx에서도 실패하지 않으므로 상태 코드를 직접 확인한다.
    if (!response.ok) {
      throw new RpcError('http', `서버가 오류를 반환했습니다. (HTTP ${response.status})`);
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new RpcError('timeout', `응답이 ${REQUEST_TIMEOUT_MS / 1000}초 동안 없어 요청을 중단했습니다.`);
      }
      throw new RpcError('invalid', '서버 응답을 해석할 수 없습니다.');
    }

    // JSON-RPC 2.0: 실패 시 result 대신 error { code, message, data? }가 온다.
    if (data.error) {
      throw new RpcError('rpc', `노드가 요청을 처리하지 못했습니다. (code ${data.error.code}: ${data.error.message})`);
    }
    if (data.result === undefined) {
      throw new RpcError('invalid', '서버 응답에 result가 없습니다.');
    }
    return data.result;
  } finally {
    clearTimeout(timeoutId);
  }
}

// 요청 전에 주소 형식만 검증한다. 문제가 있으면 메시지를, 없으면 null을 돌려준다.
// 주소는 DATA, 20 Bytes → 1바이트당 hex 2자리 → "0x" + 40자리.
// EIP-55 체크섬(대소문자) 검증은 keccak-256이 필요해 하지 않는다.
function validateAddress(address) {
  if (address.trim() === '') {
    return '주소를 입력해 주세요.';
  }
  if (address !== address.trim()) {
    return '주소 앞뒤에 공백이 있습니다. 공백을 제거해 주세요.';
  }
  if (!address.startsWith('0x')) {
    return '주소는 0x로 시작해야 합니다.';
  }
  if (address.length !== 42) {
    return `주소는 0x를 포함해 42자여야 합니다. (현재 ${address.length}자)`;
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return '주소에 16진수(0-9, a-f, A-F)가 아닌 문자가 있습니다.';
  }
  return null;
}

// RpcError는 이미 사용자용 메시지를 담고 있다. 그 밖의 예외는 원인을 콘솔에 남긴다.
function errorMessage(error) {
  if (error instanceof RpcError) return error.message;
  console.error(error);
  return '알 수 없는 오류가 발생했습니다.';
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

// 블록 번호 QUANTITY(hex 문자열)를 천 단위 구분 기호가 있는 10진수 문자열로 변환한다.
// 블록 번호는 2^53 - 1보다 훨씬 작아 Number로 변환해도 정밀도가 깨지지 않는다.
function formatBlockNumber(hexBlockNumber) {
  return Number(hexBlockNumber).toLocaleString('en-US');
}

function setLoading(loading) {
  isLoading = loading;
  searchButton.disabled = loading;
  statusArea.textContent = loading ? '조회 중...' : '';
}

// 지정한 블록 기준 잔액을 표시한다. 실패해도 예외를 밖으로 던지지 않고 화면에 표시한다.
async function showBalance(address, hexBlockNumber) {
  try {
    // 블록 파라미터(QUANTITY|TAG)에 eth_blockNumber가 준 hex 문자열을 변환 없이 그대로 넣는다.
    const hexBalance = await rpcRequest('eth_getBalance', [address, hexBlockNumber]);
    resultArea.textContent = `블록 ${formatBlockNumber(hexBlockNumber)} 기준 잔액: ${formatEther(hexBalance)} ETH`;
  } catch (error) {
    errorArea.textContent = `잔액 조회 실패: ${errorMessage(error)}`;
  }
}

// 상단 블록 번호를 갱신하고 받은 hex 문자열을 돌려준다.
// 실패하면 화면에 표시한 뒤 예외를 다시 던져, 호출한 쪽이 잔액 조회를 중단할 수 있게 한다.
async function showBlockNumber() {
  blockNumberArea.textContent = '불러오는 중...';
  blockNumberArea.classList.remove('error');
  try {
    const hexBlockNumber = await rpcRequest('eth_blockNumber', []);
    blockNumberArea.textContent = formatBlockNumber(hexBlockNumber);
    return hexBlockNumber;
  } catch (error) {
    blockNumberArea.textContent = `조회 실패 - ${errorMessage(error)}`;
    blockNumberArea.classList.add('error');
    throw error;
  }
}

async function search() {
  // 요청 중에는 Enter로도 다시 조회되지 않게 막는다.
  if (isLoading) return;

  // 새 조회를 시작하면 이전 결과와 오류를 지운다.
  resultArea.textContent = '';
  errorArea.textContent = '';

  const address = addressInput.value;
  const invalidReason = validateAddress(address);
  if (invalidReason) {
    errorArea.textContent = invalidReason;
    return;
  }

  setLoading(true);
  try {
    // 블록 번호를 먼저 받고, 같은 블록 기준으로 잔액을 조회해 두 값의 시점을 맞춘다.
    let hexBlockNumber;
    try {
      hexBlockNumber = await showBlockNumber();
    } catch (error) {
      // "latest"로 대체하지 않고 잔액 요청을 보내지 않는다.
      errorArea.textContent = `블록 번호 조회에 실패해 잔액을 조회하지 않았습니다: ${errorMessage(error)}`;
      return;
    }
    await showBalance(address, hexBlockNumber);
  } finally {
    // 성공하든 실패하든 로딩 상태를 해제한다.
    setLoading(false);
  }
}

searchButton.addEventListener('click', search);
addressInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') search();
});

// 페이지를 열었을 때 한 번 블록 번호를 표시한다. (오류는 showBlockNumber가 이미 화면에 표시했다)
showBlockNumber().catch(() => {});
