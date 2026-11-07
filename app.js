if ("serviceWorker" in navigator) { window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(()=>{})); }
document.getElementById("add").addEventListener("click",()=>alert("سنفعّل إضافة الأجهزة والربط الآمن في الخطوة التالية."));
