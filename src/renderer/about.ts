const version = new URLSearchParams(window.location.search).get("version");
const element = document.getElementById("version");
if (element) element.textContent = version ? `Version ${version}` : "NOVA";
