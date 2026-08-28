// popup.js

document.addEventListener("DOMContentLoaded", () => {
  const serverStatus = document.getElementById("server-status");
  const liStatus = document.getElementById("li-status");
  const reconnectBtn = document.getElementById("reconnect-btn");

  function updateStatus() {
    chrome.runtime.sendMessage({ type: "GET_STATUS" }, (response) => {
      if (chrome.runtime.lastError || !response) {
        setServerOffline();
        return;
      }
      if (response.isConnected) {
        setServerOnline();
      } else {
        setServerOffline();
      }
    });

    chrome.cookies.get({ url: "https://www.linkedin.com", name: "JSESSIONID" }, (cookie) => {
      if (cookie && cookie.value) {
        liStatus.className = "status-badge badge-online";
        liStatus.innerHTML = '<span class="dot dot-green"></span> Logged In';
      } else {
        liStatus.className = "status-badge badge-offline";
        liStatus.innerHTML = '<span class="dot dot-red"></span> Not Logged In';
      }
    });
  }

  function setServerOnline() {
    serverStatus.className = "status-badge badge-online";
    serverStatus.innerHTML = '<span class="dot dot-green"></span> Connected';
  }

  function setServerOffline() {
    serverStatus.className = "status-badge badge-offline";
    serverStatus.innerHTML = '<span class="dot dot-red"></span> Disconnected';
  }

  reconnectBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "RECONNECT" }, (response) => {
      updateStatus();
    });
  });

  updateStatus();
  setInterval(updateStatus, 2000);
});
