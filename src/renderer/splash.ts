const version = new URLSearchParams(window.location.search).get("version");
const element = document.getElementById("version");
if (element && version) element.textContent = `Version ${version}`;

export {};
