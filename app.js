
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

const $ = selector => document.querySelector(selector);

const addButton = $("#add");
const urlInput = $("#deviceUrl");
const nameInput = $("#customDeviceName");
const addMessage = $("#addMessage");
const devicesList = $("#devicesList");
const alertsList = $("#alertsList");
const deviceCount = $("#deviceCount");
const alertCount = $("#alertCount");
const headerStatus = $("header .status");

const STORAGE_KEY = "mirah_devices";
const OLD_KEY = "mirah_connection";
const HISTORY_LIMIT = 30;

let devices = [];
let alerts = [];

function saveDevices() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(
      devices.map(({ url, token, id, name }) => ({
        url, token, id, name
      }))
    )
  );
}

function loadDevices() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (Array.isArray(saved)) devices = saved;
  } catch {
    devices = [];
  }

  if (!devices.length) {
    try {
      const old = JSON.parse(localStorage.getItem(OLD_KEY) || "null");

      if (old?.url && old?.token) {
        devices.push({
          url: old.url,
          token: old.token,
          id: old.url,
          name: "جهاز الكمبيوتر"
        });
        saveDevices();
      }
    } catch {}
  }

  devices.forEach(device => {
    device.history = [];
  });
}

function showMessage(message) {
  addMessage.textContent = message;
}

function makeElement(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}

function formatGB(value) {
  return Number(value).toFixed(1) + " GB";
}

function formatSpeed(value) {
  return value == null ? "غير متاح" : Number(value).toFixed(2) + " Mbps";
}

function formatUptime(seconds) {
  if (seconds == null) return "غير متاح";

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  return `${days} يوم، ${hours} ساعة، ${minutes} دقيقة`;
}

function getBatteryText(battery) {
  if (!battery?.available) return "غير متاحة";

  return battery.percent + "% " +
    (battery.charging ? "⚡ يشحن" : "غير موصول بالشاحن");
}

function addHistory(device, data) {
  if (!Array.isArray(device.history)) device.history = [];

  const cpu = Number(data.cpuUsagePercent);
  const ram = Number(data.memoryUsedPercent);

  if (Number.isFinite(cpu)) {
    device.history.push({
      time: Date.now(),
      cpu: Math.max(0, Math.min(100, cpu)),
      ram: Number.isFinite(ram)
        ? Math.max(0, Math.min(100, ram))
        : null
    });

    device.history = device.history.slice(-HISTORY_LIMIT);
  }
}

function drawChart(canvas, history, key, color) {
  if (!canvas || !history?.length) return;

  const width = Math.max(220, canvas.clientWidth);
  const height = 115;
  const ratio = window.devicePixelRatio || 1;

  canvas.width = width * ratio;
  canvas.height = height * ratio;

  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const left = 5;
  const right = width - 5;
  const top = 10;
  const bottom = 88;
  const chartWidth = right - left;
  const chartHeight = bottom - top;

  ctx.font = "10px Arial";
  ctx.textAlign = "left";
  ctx.fillStyle = "#858da2";

  [0, 50, 100].forEach(value => {
    const y = bottom - (value / 100) * chartHeight;

    ctx.beginPath();
    ctx.strokeStyle = "#293140";
    ctx.lineWidth = 1;
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();

    ctx.fillText(value + "%", left + 2, y - 4);
  });

  const points = history
    .map((item, index) => ({
      x: history.length === 1
        ? right
        : left + (index / (history.length - 1)) * chartWidth,
      y: item[key] == null
        ? null
        : bottom - (item[key] / 100) * chartHeight
    }))
    .filter(point => point.y !== null);

  if (!points.length) return;

  if (points.length > 1) {
    const gradient = ctx.createLinearGradient(0, top, 0, bottom);
    gradient.addColorStop(0, color + "40");
    gradient.addColorStop(1, color + "00");

    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.lineTo(points[points.length - 1].x, bottom);
    ctx.lineTo(points[0].x, bottom);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  }

  const last = points[points.length - 1];

  ctx.beginPath();
  ctx.arc(last.x, last.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function createChart(title, value, key, color, history) {
  const box = makeElement("div", "performance-chart");

  const heading = makeElement("div", "chart-heading");
  heading.append(
    makeElement("span", "chart-title", title),
    makeElement("b", "chart-value", value == null ? "—" : value + "%")
  );

  const canvas = document.createElement("canvas");
  canvas.className = "performance-canvas";
  canvas.setAttribute("aria-label", title);

  box.append(heading, canvas);

  requestAnimationFrame(() => {
    drawChart(canvas, history, key, color);
  });

  return box;
}

function getDeviceAlerts(device) {
  const result = [];

  if (!device.online) {
    result.push({
      level: "danger",
      title: "الجهاز غير متصل",
      details: "تعذر الاتصال بهذا الجهاز."
    });
    return result;
  }

  const data = device.data;
  if (!data) return result;

  if (Number(data.cpuUsagePercent) >= 90) {
    result.push({
      level: "warning",
      title: "استخدام المعالج مرتفع",
      details: "استخدام CPU وصل إلى " + data.cpuUsagePercent + "%."
    });
  }

  if (Number(data.memoryUsedPercent) >= 90) {
    result.push({
      level: "warning",
      title: "استهلاك الذاكرة مرتفع",
      details: "استخدام RAM وصل إلى " + data.memoryUsedPercent + "%."
    });
  }

  for (const disk of data.disks || []) {
    if (Number(disk.usedPercent) >= 90) {
      result.push({
        level: "warning",
        title: "مساحة التخزين شبه ممتلئة",
        details: disk.name + " مستخدم بنسبة " + disk.usedPercent + "%."
      });
    }
  }

  if (data.battery?.available &&
      Number(data.battery.percent) <= 15 &&
      !data.battery.charging) {
    result.push({
      level: "warning",
      title: "مستوى البطارية منخفض",
      details: "البطارية وصلت إلى " + data.battery.percent + "%."
    });
  }

  return result;
}

function renderDevices() {
  devicesList.replaceChildren();
  deviceCount.textContent = devices.length + " أجهزة";

  if (!devices.length) {
    const empty = makeElement("div", "notice");
    empty.append(
      makeElement("b", "", "لا توجد أجهزة مربوطة"),
      makeElement("p", "", "انتقل إلى واجهة إضافة جهاز لربط أول كمبيوتر.")
    );
    devicesList.append(empty);
    return;
  }

  devices.forEach((device, index) => {
    const card = makeElement("div", "device");
    const top = makeElement("div", "device-top");

    top.append(makeElement("div", "pc-icon", "▣"));

    const nameBox = makeElement("div", "device-name");
    nameBox.append(
      makeElement("b", "", device.name),
      makeElement("small", "", device.data?.deviceName || device.url)
    );

    top.append(nameBox);

    top.append(makeElement(
      "span",
      device.online ? "online" : "offline",
      device.online ? "متصل" : "غير متصل"
    ));

    card.append(top);

    if (device.data) {
      const data = device.data;
      const disks = data.disks || [];

      const total = disks.reduce(
        (sum, disk) => sum + Number(disk.totalGb || 0), 0
      );

      const used = disks.reduce(
        (sum, disk) => sum + Number(disk.usedGb || 0), 0
      );

      const metrics = makeElement("div", "metrics");

      const values = [
        ["استخدام المعالج CPU", data.cpuUsagePercent == null ? "جارٍ القياس" : data.cpuUsagePercent + "%"],
        ["طراز المعالج", data.processor || "غير معروف"],
        ["عدد الأنوية", data.processorCount ?? "غير متاح"],
        ["استخدام الذاكرة RAM", data.memoryUsedPercent + "%"],
        ["الذاكرة المستخدمة", formatGB((data.memoryTotalGb || 0) - (data.memoryAvailableGb || 0))],
        ["الذاكرة المتاحة", formatGB(data.memoryAvailableGb || 0)],
        ["التخزين المستخدم", disks.length ? formatGB(used) + " / " + formatGB(total) : "غير متاح"],
        ["تنزيل الشبكة", formatSpeed(data.networkDownloadMbps)],
        ["رفع الشبكة", formatSpeed(data.networkUploadMbps)],
        ["مدة تشغيل الكمبيوتر", formatUptime(data.uptimeSeconds)],
        ["العمليات الجارية", data.processCount ?? "غير متاح"],
        ["البطارية", getBatteryText(data.battery)],
        ["نظام التشغيل", data.os || "غير معروف"]
      ];

      values.forEach(([label, value]) => {
        const box = makeElement("div", "metric-item");
        box.append(
          makeElement("small", "", label),
          makeElement("b", "", String(value))
        );
        metrics.append(box);
      });

      card.append(metrics);

      const charts = makeElement("div", "charts-section");
      charts.append(
        makeElement("h3", "charts-title", "تحليل الأداء المباشر"),
        makeElement("p", "charts-subtitle", "آخر 30 قراءة · تحديث كل 15 ثانية")
      );

      const chartGrid = makeElement("div", "charts-grid");

      chartGrid.append(
        createChart(
          "المعالج CPU",
          data.cpuUsagePercent,
          "cpu",
          "#20e6cf",
          device.history
        ),
        createChart(
          "الذاكرة RAM",
          data.memoryUsedPercent,
          "ram",
          "#a78bfa",
          device.history
        )
      );

      charts.append(chartGrid);
      card.append(charts);
    }

    card.append(makeElement(
      "p",
      "hint",
      device.online
        ? "آخر تحديث: " + new Date(device.lastSeen).toLocaleTimeString("ar-SA")
        : "تأكد من تشغيل الكمبيوتر وTailscale."
    ));

    const actions = makeElement("div", "device-actions");

    const renameButton = makeElement("button", "secondary-action", "تغيير الاسم");
    renameButton.addEventListener("click", () => renameDevice(index));

    const deleteButton = makeElement("button", "delete-action", "حذف الجهاز");
    deleteButton.addEventListener("click", () => deleteDevice(index));

    actions.append(renameButton, deleteButton);
    card.append(actions);

    devicesList.append(card);
  });
}

function renameDevice(index) {
  const device = devices[index];
  if (!device) return;

  const newName = prompt("اكتب الاسم الجديد للجهاز:", device.name);
  if (!newName || !newName.trim()) return;

  device.name = newName.trim();
  saveDevices();
  renderDevices();
}

function deleteDevice(index) {
  const device = devices[index];
  if (!device) return;

  if (!confirm("هل تريد حذف " + device.name + " من التطبيق؟")) return;

  devices.splice(index, 1);
  saveDevices();
  renderDevices();
  renderAlerts();
  updateHeader();
}

function renderAlerts() {
  alertsList.replaceChildren();

  alerts = devices.flatMap(device =>
    getDeviceAlerts(device).map(alert => ({
      ...alert,
      deviceName: device.name
    }))
  );

  alertCount.textContent = alerts.length + " تنبيهات";

  if (!alerts.length) {
    const empty = makeElement("div", "notice");
    empty.append(
      makeElement("b", "", "كل الأجهزة بحالة جيدة"),
      makeElement("p", "", "لا توجد مشاكل مكتشفة حاليًا.")
    );
    alertsList.append(empty);
    return;
  }

  alerts.forEach(alert => {
    const card = makeElement("div", "alert-card " + alert.level);
    card.append(
      makeElement("b", "", alert.title),
      makeElement("div", "alert-device", "الجهاز: " + alert.deviceName),
      makeElement("p", "", alert.details)
    );
    alertsList.append(card);
  });
}

function updateHeader() {
  const online = devices.filter(d => d.online).length;

  headerStatus.textContent = devices.length
    ? online + " من " + devices.length + " متصل"
    : "لا توجد أجهزة";
}

async function refreshDevice(device) {
  try {
    const response = await fetch(
      device.url + "/api/status",
      {
        headers: { "X-Mirah-Token": device.token },
        cache: "no-store"
      }
    );

    if (!response.ok) throw new Error("Connection failed");

    const data = await response.json();

    device.data = data;
    device.online = true;
    device.lastSeen = Date.now();

    addHistory(device, data);

  } catch {
    device.online = false;
  }

  renderDevices();
  renderAlerts();
  updateHeader();
}

async function refreshAll() {
  await Promise.all(devices.map(refreshDevice));
}

async function pairDevice() {
  let url;

  try {
    const parsed = new URL(urlInput.value.trim());

    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname.endsWith(".ts.net") ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error("رابط غير صالح");
    }

    url = parsed.origin;

  } catch {
    showMessage("أدخل رابط Tailscale صحيحًا يبدأ بـ https://");
    return;
  }

  if (devices.some(d => d.url === url)) {
    showMessage("هذا الجهاز موجود بالفعل في القائمة.");
    return;
  }

  addButton.disabled = true;
  addButton.textContent = "جارٍ الربط...";
  showMessage("جارٍ الاتصال بالكمبيوتر...");

  try {
    const response = await fetch(url + "/api/pairing", { cache: "no-store" });

    if (!response.ok) throw new Error("تعذر الوصول للكمبيوتر");

    const pairing = await response.json();
    if (!pairing.token) throw new Error("بيانات الربط غير مكتملة");

    const device = {
      url,
      token: pairing.token,
      id: pairing.id || url,
      name: nameInput.value.trim() || pairing.name || "جهاز جديد",
      online: false,
      data: null,
      lastSeen: null,
      history: []
    };

    devices.push(device);
    await refreshDevice(device);

    if (!device.online) {
      devices.pop();
      throw new Error("تعذر التحقق من اتصال الجهاز");
    }

    saveDevices();
    urlInput.value = "";
    nameInput.value = "";
    showMessage("تم ربط الجهاز بنجاح.");

    renderDevices();
    renderAlerts();
    updateHeader();
    showPage("devicesPage");

  } catch (error) {
    showMessage("فشل الربط: " + error.message);

  } finally {
    addButton.disabled = false;
    addButton.textContent = "＋ ربط جهاز";
  }
}

function showPage(pageId) {
  document.querySelectorAll(".page").forEach(page => {
    page.classList.toggle("active", page.id === pageId);
  });

  document.querySelectorAll(".nav-item").forEach(button => {
    button.classList.toggle("active", button.dataset.page === pageId);
  });

  if (pageId === "devicesPage") {
    requestAnimationFrame(() => {
      devicesList.querySelectorAll(".performance-canvas").forEach(canvas => {
        const deviceCard = canvas.closest(".device");
        const index = [...devicesList.children].indexOf(deviceCard);
        const device = devices[index];
        if (!device) return;

        const isCpu = canvas.closest(".performance-chart")
          .querySelector(".chart-title").textContent.includes("CPU");

        drawChart(
          canvas,
          device.history,
          isCpu ? "cpu" : "ram",
          isCpu ? "#20e6cf" : "#a78bfa"
        );
      });
    });
  }
}

document.querySelectorAll(".nav-item").forEach(button => {
  button.addEventListener("click", () => showPage(button.dataset.page));
});

window.addEventListener("resize", () => {
  if ($("#devicesPage")?.classList.contains("active")) {
    renderDevices();
  }
});

addButton.addEventListener("click", pairDevice);

loadDevices();
renderDevices();
renderAlerts();
updateHeader();

refreshAll();
setInterval(refreshAll, 15000);
