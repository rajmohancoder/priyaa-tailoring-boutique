const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const cloudEnabled = Boolean(SUPABASE_URL && SUPABASE_KEY);

const listeners = new Set();
let saveSeq = 0;

export const DEFAULT_SETTINGS = {
  highContrast: false,
  largeText: false,
  unit: "inch",
  palette: "terracotta",
  fontPair: "friendly",
};

function emit(status) {
  listeners.forEach((listener) => listener(status));
}

export function subscribeSync(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function apiHeaders(extra = {}) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function request(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: apiHeaders(options.headers),
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export async function fileToDataUrl(file) {
  if (!file.type.startsWith("image/")) throw new Error("Only image files are allowed");
  const original = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read image"));
    reader.readAsDataURL(file);
  });

  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not process image"));
      img.src = original;
    });
    const maxSide = 1200;
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", 0.82);
  } catch {
    return original;
  }
}

const stamp = () => new Date().toISOString();

function customerRow(customer) {
  return {
    id: customer.id,
    name: customer.name,
    mobile: customer.mobile,
    address: customer.address || "",
    notes: customer.notes || "",
    updated_at: stamp(),
  };
}

function orderRow(customerId, order, index, includeCreatedAt = false) {
  const row = {
    id: order.id,
    customer_id: customerId,
    garment: order.garment,
    garment_label: order.garmentLabel || order.garment,
    delivery_date: order.deliveryDate || null,
    status: order.status || "Order received",
    measurements: order.measurements || {},
    total_amount: order.totalAmount ?? null,
    advance_paid: order.advancePaid ?? null,
    reference_images: Array.isArray(order.referenceImages) ? order.referenceImages : [],
    updated_at: stamp(),
  };
  if (includeCreatedAt) {
    row.created_at = new Date(Date.now() - index * 1000).toISOString();
  }
  return row;
}

function orderRows(customers, includeCreatedAt = false) {
  return customers.flatMap((customer, ci) =>
    (customer.orders || []).map((order, oi) =>
      orderRow(customer.id, order, ci * 1000 + oi, includeCreatedAt)
    )
  );
}

function fromRows(rows) {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    mobile: row.mobile,
    address: row.address || "",
    notes: row.notes || "",
    orders: (row.orders || [])
      .slice()
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
      .map((order) => ({
        id: order.id,
        garment: order.garment,
        garmentLabel: order.garment_label || order.garment,
        deliveryDate: order.delivery_date || "",
        status: order.status === "New" ? "Order received" : order.status,
        measurements: order.measurements || {},
        ...(order.total_amount != null ? { totalAmount: Number(order.total_amount) } : {}),
        ...(order.advance_paid != null ? { advancePaid: Number(order.advance_paid) } : {}),
        referenceImages: Array.isArray(order.reference_images) ? order.reference_images : [],
      })),
  }));
}

async function pushCustomers(customers) {
  const customerRows = customers.map(customerRow);
  if (customerRows.length) {
    await request("customers?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(customerRows),
    });
  }
  const rows = orderRows(customers);
  if (rows.length) {
    await request("orders?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows),
    });
  }
}

async function pushSettings(settings) {
  await request("settings?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ id: "app", data: settings, updated_at: stamp() }]),
  });
}

export async function bootstrap() {
  emit("loading");
  if (!cloudEnabled) {
    emit("offline");
    return { customers: [], settings: DEFAULT_SETTINGS };
  }
  try {
    const [rows, settingRows] = await Promise.all([
      request("customers?select=*,orders(*)"),
      request("settings?id=eq.app&select=data"),
    ]);
    emit("saved");
    return {
      customers: fromRows(rows),
      settings: { ...DEFAULT_SETTINGS, ...(settingRows[0]?.data || {}) },
    };
  } catch {
    emit("offline");
    return { customers: [], settings: DEFAULT_SETTINGS };
  }
}

export function saveState(customers, settings, onError) {
  if (!cloudEnabled) {
    emit("offline");
    onError?.();
    return;
  }
  const seq = ++saveSeq;
  emit("saving");
  Promise.all([pushCustomers(customers), pushSettings(settings)]).then(
    () => { if (seq === saveSeq) emit("saved"); },
    () => {
      if (seq === saveSeq) {
        emit("offline");
        onError?.();
      }
    }
  );
}

export async function replaceCustomers(customers) {
  if (!cloudEnabled) {
    emit("offline");
    return;
  }
  const seq = ++saveSeq;
  emit("saving");
  try {
    const rows = await request("customers?select=id");
    const keep = new Set(customers.map((c) => c.id));
    const stale = rows.map((r) => r.id).filter((id) => !keep.has(id));
    if (stale.length) {
      const ids = stale.map((id) => `"${id.replace(/"/g, '\\"')}"`).join(",");
      await request(`customers?id=in.(${ids})`, {
        method: "DELETE",
        headers: { Prefer: "return=minimal" },
      });
    }
    await pushCustomers(customers);
    if (seq === saveSeq) emit("saved");
  } catch {
    if (seq === saveSeq) emit("offline");
  }
}

export function buildBackup(customers, settings) {
  return JSON.stringify(
    {
      app: "priyaa-measurement-book",
      version: 1,
      exportedAt: new Date().toISOString(),
      customers,
      settings,
    },
    null,
    2
  );
}

export function parseBackup(text) {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.customers)) {
    throw new Error("Not a valid Priyaa backup file");
  }
  return data;
}
