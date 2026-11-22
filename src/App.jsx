import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import priyaaLogo from "./assets/priyaa-two.png";
import {
  GARMENT_TYPES,
  MEASUREMENT_TEMPLATES,
  ORDER_STATUSES,
} from "./data.js";
import {
  DEFAULT_SETTINGS,
  bootstrap,
  fileToDataUrl,
  saveState,
  subscribeSync,
} from "./storage.js";

const nid = (p) => {
  if (typeof crypto !== "undefined" && crypto.randomUUID)
    return `${p}${crypto.randomUUID()}`;
  return `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
};

/* Appearance Lab — palettes + font pairings to compare live.
   Dots: [background, primary button, accent] */
export const THEMES = [
  {
    id: "terracotta",
    name: "Warm Terracotta",
    why: "Cozy & familiar — current default",
    dots: ["#FFF8F0", "#B85C38", "#E9A44A"],
  },
  {
    id: "marigold",
    name: "Marigold Festival",
    why: "Highest warmth; strong button contrast",
    dots: ["#FFF9EC", "#A86A00", "#D98E00"],
  },
  {
    id: "rose",
    name: "Rose Boutique",
    why: "Feminine tailoring vibe; soft on eyes",
    dots: ["#FFF5F7", "#A63D5E", "#D97A94"],
  },
  {
    id: "sage",
    name: "Sage Calm",
    why: "Lowest eye strain for long sessions",
    dots: ["#F5F6EF", "#5F7161", "#9AA86B"],
  },
  {
    id: "ocean",
    name: "Ocean Professional",
    why: "Max legibility; most businesslike",
    dots: ["#F1F7F9", "#0F6C7A", "#E9A44A"],
  },
];

export const FONT_PAIRINGS = [
  {
    id: "friendly",
    name: "Rounded Friendly",
    detail: "Nunito for headings and body — the app default",
    head: '"Nunito", sans-serif',
    body: '"Nunito", sans-serif',
  },
  {
    id: "classic",
    name: "Classic Tailor",
    detail: "Poppins headings + Lora serif body — professional print feel",
    head: '"Poppins", sans-serif',
    body: '"Lora", serif',
  },
  {
    id: "clear",
    name: "Extra Clear",
    detail: "Inter everywhere, wider spacing — best for weak eyesight",
    head: '"Inter", sans-serif',
    body: '"Inter", sans-serif',
  },
];

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function toDateInputValue(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function defaultDeliveryDate() {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  while (date.getDay() === 0 || date.getDay() === 6) {
    date.setDate(date.getDate() + 1);
  }
  return toDateInputValue(date);
}

function firstError(results, fallback) {
  const failed = results.find((result) => result.status === "rejected");
  return failed?.reason?.message || fallback;
}

function formatMoney(value) {
  if (value == null || value === "") return "—";
  return `₹${Number(value).toLocaleString("en-IN")}`;
}

const digitsOnly = (value) => value.replace(/\D/g, "");
const isValidMobile = (value) => digitsOnly(value).length === 10;
const DECIMAL_VALUE = /^(?:\d{1,2}(?:\.\d{0,2})?|\.\d{1,2})$/;
const isValidMeasurement = (value) =>
  value === "" || DECIMAL_VALUE.test(String(value));
const sanitizeMeasurement = (value) => {
  const text = String(value).replace(/[^\d.]/g, "");
  const dot = text.indexOf(".");
  if (dot === -1) return text.slice(0, 2);
  return `${text.slice(0, dot).slice(0, 2)}.${text
    .slice(dot + 1)
    .replace(/\./g, "")
    .slice(0, 2)}`;
};
const sanitizeMeasurements = (measurements) =>
  Object.fromEntries(
    Object.entries(measurements || {}).map(([key, value]) => [
      key,
      sanitizeMeasurement(value),
    ]),
  );
const CUSTOM_PREFIX = "Custom: ";
const displayMeasurementName = (key) =>
  key.startsWith(CUSTOM_PREFIX) ? key.slice(CUSTOM_PREFIX.length) : key;
const splitMeasurements = (measurements, templateFields) => {
  const standard = {};
  const customs = [];
  Object.entries(sanitizeMeasurements(measurements)).forEach(([key, value]) => {
    if (templateFields.includes(key)) standard[key] = value;
    else
      customs.push({ name: displayMeasurementName(key), value });
  });
  return { standard, customs: customs.slice(0, 2) };
};
const mergeMeasurements = (standard, customs) => {
  const merged = { ...standard };
  customs.forEach(({ name, value }) => {
    const cleanName = name.trim();
    const cleanValue = String(value).trim();
    if (cleanName && cleanValue)
      merged[`${CUSTOM_PREFIX}${cleanName}`] = cleanValue;
  });
  return Object.fromEntries(
    Object.entries(merged).filter(([, value]) => String(value).trim() !== ""),
  );
};
const sanitizeCustomName = (value) =>
  String(value).replace(/[^\p{L}\s&'()/-]/gu, "");
const isValidCustomName = (value) => /\p{L}/u.test(value);
const isValidCustoms = (customs) =>
  customs.every(({ value }) => !value || isValidMeasurement(value));
const hasIncompleteCustoms = (customs) =>
  customs.some(({ name, value }) => {
    const text = String(value).trim();
    return !isValidCustomName(name.trim()) || !text || Number(text) === 0;
  });
const isValidName = (value) =>
  value.trim().length > 0 && value.trim().length <= 50;

function CustomMeasurements({ customs, unit, onChange, onAdd, onRemove }) {
  return (
    <>
      {customs.map((custom, i) => (
        <div className="measure-row custom-row" key={i}>
          <input
            className="text-input custom-name"
            placeholder="Custom name"
            value={custom.name}
            onChange={(e) =>
              onChange(i, "name", sanitizeCustomName(e.target.value))
            }
            aria-label={`Custom measurement ${i + 1} name`}
          />
          <span className="with-unit">
            <input
              inputMode="decimal"
              type="text"
              placeholder="0"
              value={custom.value}
              onChange={(e) =>
                onChange(i, "value", sanitizeMeasurement(e.target.value))
              }
              aria-label={`Custom measurement ${i + 1} value`}
            />
            <span className="unit-label">
              {unit === "inch" ? "in" : "cm"}
            </span>
            <button
              type="button"
              className="custom-remove"
              onClick={() => onRemove(i)}
              aria-label={`Remove custom measurement ${i + 1}`}
            >
              ×
            </button>
          </span>
        </div>
      ))}
      {customs.length < 2 && (
        <button type="button" className="add-custom" onClick={onAdd}>
          {customs.length === 0
            ? "＋ Add custom value"
            : "＋ Add another custom value"}
        </button>
      )}
    </>
  );
}

function statusClass(status) {
  switch (status) {
    case "Completed":
    case "Hand Over":
    case "Ready":
      return "status-ready";
    case "In stitching":
    case "In wait":
      return "status-progress";
    default:
      return "status-new";
  }
}

function upcomingOrder(customer) {
  return customer.orders
    .filter((o) => o.status !== "Hand Over")
    .sort((a, b) =>
      (a.deliveryDate || "9999-12-31").localeCompare(
        b.deliveryDate || "9999-12-31",
      ),
    )[0];
}

function byDueDate(a, b) {
  const ad = upcomingOrder(a)?.deliveryDate || "9999-12-31";
  const bd = upcomingOrder(b)?.deliveryDate || "9999-12-31";
  return ad.localeCompare(bd);
}

function LogoMark({ size = 46, inverse = false, labelled = true }) {
  return (
    <img
      className={`brand-logo priyaa-logo ${inverse ? "inverse" : ""}`}
      src={priyaaLogo}
      style={{ height: size }}
      alt={labelled ? "Priyaa Dresses logo" : ""}
      aria-hidden={labelled ? undefined : true}
    />
  );
}

export default function App() {
  const [customers, setCustomers] = useState([]);
  const [route, setRoute] = useState({ name: "home" });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState("");
  const [dialog, setDialog] = useState(null);
  const [hydrated, setHydrated] = useState(false);
  const [syncStatus, setSyncStatus] = useState("loading");
  const [retry, setRetry] = useState(0);
  const [highContrast, setHighContrast] = useState(
    DEFAULT_SETTINGS.highContrast,
  );
  const [largeText, setLargeText] = useState(DEFAULT_SETTINGS.largeText);
  const [unit, setUnit] = useState(DEFAULT_SETTINGS.unit);
  const [palette, setPalette] = useState(DEFAULT_SETTINGS.palette);
  const [fontPair, setFontPair] = useState(DEFAULT_SETTINGS.fontPair);

  const toastTimer = useRef(null);
  const showToast = useCallback((msg) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2200);
  }, []);

  useEffect(() => subscribeSync(setSyncStatus), []);

  useEffect(() => {
    let cancelled = false;
    bootstrap().then((data) => {
      if (cancelled) return;
      setCustomers(data.customers);
      setHighContrast(data.settings.highContrast);
      setLargeText(data.settings.largeText);
      setUnit(data.settings.unit);
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [retry]);

  useEffect(() => {
    if (hydrated) {
      saveState(
        customers,
        { highContrast, largeText, unit, palette, fontPair },
        () => showToast("Couldn't save changes — check your connection"),
      );
    }
  }, [
    customers,
    highContrast,
    largeText,
    unit,
    palette,
    fontPair,
    hydrated,
    showToast,
  ]);

  const showDialog = (title, message) => setDialog({ title, message });

  const go = (name, extra = {}) => {
    setRoute({ name, ...extra });
    setDrawerOpen(false);
    window.scrollTo(0, 0);
  };

  const activeCustomer = useMemo(
    () => customers.find((c) => c.id === route.customerId),
    [customers, route.customerId],
  );

  const filtered = customers.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      c.mobile.replace(/\s/g, "").includes(q.replace(/\s/g, "")) ||
      c.orders.some((o) => o.garmentLabel.toLowerCase().includes(q))
    );
  });

  const sortedFiltered = [...filtered].sort(byDueDate);
  const isAllCustomers = route.name === "all";
  const visibleCustomers =
    isAllCustomers || search.trim()
      ? sortedFiltered
      : sortedFiltered.slice(0, 5);

  const addCustomer = (fields) => {
    const name = fields.name.trim();
    const c = { id: nid("c"), orders: [], ...fields, name };
    setCustomers((prev) => [c, ...prev]);
    showDialog("Customer added", `${name} has been added.`);
    go("customer", { customerId: c.id });
  };

  const updateCustomer = (id, fields) => {
    const name = (
      fields.name ||
      customers.find((c) => c.id === id)?.name ||
      ""
    ).trim();
    setCustomers((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...fields } : c)),
    );
    showDialog("Customer updated", `${name}'s details have been saved.`);
  };

  const saveMeasurement = async (
    customerId,
    garmentId,
    deliveryDate,
    values,
    payment = {},
    imageFiles = [],
  ) => {
    const g = GARMENT_TYPES.find((x) => x.id === garmentId);
    const label = g ? g.label : garmentId;
    const customerName = customers.find((c) => c.id === customerId)?.name;
    const orderId = nid("o");

    let referenceImages = [];
    if (imageFiles.length) {
      const results = await Promise.allSettled(
        imageFiles.map((file) => fileToDataUrl(file)),
      );
      referenceImages = results
        .filter((result) => result.status === "fulfilled")
        .map((result) => result.value);
      if (referenceImages.length !== imageFiles.length) {
        showToast(
          `Garment saved, but ${firstError(results, "some images could not be processed")}`,
        );
      }
    }

    setCustomers((prev) =>
      prev.map((c) =>
        c.id === customerId
          ? {
              ...c,
              orders: [
                {
                  id: orderId,
                  garment: garmentId,
                  garmentLabel: label,
                  deliveryDate,
                  status: ORDER_STATUSES[0],
                  measurements: values,
                  totalAmount: payment.totalAmount ?? null,
                  advancePaid: payment.advancePaid ?? null,
                  referenceImages,
                },
                ...c.orders,
              ],
            }
          : c,
      ),
    );
    showDialog(
      "Garment added",
      `${label} was added${customerName ? ` for ${customerName}` : ""}.`,
    );
    go("customer", { customerId });
  };

  const updateOrder = async (
    customerId,
    orderId,
    fields,
    imageOptions = {},
  ) => {
    const label = customers
      .find((c) => c.id === customerId)
      ?.orders.find((o) => o.id === orderId)?.garmentLabel;
    const { imageFiles = [] } = imageOptions;
    const keptImages = Array.isArray(fields.referenceImages)
      ? fields.referenceImages
      : [];

    let newImages = [];
    if (imageFiles.length) {
      const results = await Promise.allSettled(
        imageFiles.map((file) => fileToDataUrl(file)),
      );
      newImages = results
        .filter((result) => result.status === "fulfilled")
        .map((result) => result.value);
      if (newImages.length !== imageFiles.length) {
        showToast(firstError(results, "Some images could not be processed"));
      }
    }

    const referenceImages = [...keptImages, ...newImages].slice(0, 2);
    setCustomers((prev) =>
      prev.map((c) =>
        c.id === customerId
          ? {
              ...c,
              orders: c.orders.map((o) =>
                o.id === orderId ? { ...o, ...fields, referenceImages } : o,
              ),
            }
          : c,
      ),
    );
    showDialog(
      "Garment updated",
      `Changes to ${label || "the garment"} have been saved.`,
    );
  };

  return (
    <div
      className={`theme-${palette} font-${fontPair} ${highContrast ? "high-contrast" : ""} ${largeText ? "large-text" : ""}`}
    >
      <header className="app-header">
        <button
          className="icon-btn"
          aria-label="Open navigation menu"
          onClick={() => setDrawerOpen(true)}
        >
          ☰
        </button>
        <button
          className="brand brand-link"
          onClick={() => go("home")}
          aria-label="Go to home"
        >
          <LogoMark />
          <div className="brand-text">
            <strong>Priyaa Measurement Book</strong>
            <span>Your Personal Tailoring Assistant</span>
          </div>
        </button>
        <div className="header-spacer" />
        <button
          className="header-count"
          onClick={() => go("all")}
          aria-label={`View all ${customers.length} customers by due date`}
        >
          {customers.length} customers
        </button>
      </header>

      <Drawer
        open={drawerOpen}
        route={route}
        onClose={() => setDrawerOpen(false)}
        onGo={go}
      />

      <main className="page" role="main">
        {!hydrated ? (
          <div className="empty">
            <p style={{ fontSize: 20, fontWeight: 800, color: "var(--text)" }}>
              {syncStatus === "offline"
                ? "Couldn't load data from the server."
                : "Loading your data…"}
            </p>
            {syncStatus === "offline" && (
              <button
                className="btn btn-primary"
                onClick={() => {
                  setHydrated(false);
                  setRetry((n) => n + 1);
                }}
              >
                Retry
              </button>
            )}
          </div>
        ) : (
          <>
            {(route.name === "home" || route.name === "all") && (
              <HomeScreen
                customers={visibleCustomers}
                title={isAllCustomers ? "All Customers" : "Recent Customers"}
                subtitle={
                  isAllCustomers
                    ? "All customers sorted by nearest due date."
                    : "Showing 5 customers with the nearest due dates."
                }
                search={search}
                setSearch={setSearch}
                onOpen={(id, target) =>
                  go("customer", { customerId: id, target })
                }
                unit={unit}
              />
            )}

            {route.name === "customer" && activeCustomer && (
              <CustomerDetailScreen
                customer={activeCustomer}
                unit={unit}
                focusOrders={route.target === "orders"}
                onBack={() => go("home")}
                onEdit={(fields) => updateCustomer(activeCustomer.id, fields)}
                onUpdateOrder={(orderId, fields, options) =>
                  updateOrder(activeCustomer.id, orderId, fields, options)
                }
                onAddMeasurement={() =>
                  go("addMeasurement", { customerId: activeCustomer.id })
                }
              />
            )}

            {route.name === "addCustomer" && (
              <AddCustomerScreen
                onBack={() => go("home")}
                onSave={addCustomer}
              />
            )}

            {route.name === "addMeasurement" && activeCustomer && (
              <AddMeasurementScreen
                customer={activeCustomer}
                unit={unit}
                onBack={() => go("customer", { customerId: activeCustomer.id })}
                onSave={saveMeasurement}
              />
            )}

            {route.name === "settings" && (
              <SettingsScreen
                onBack={() => go("home")}
                highContrast={highContrast}
                setHighContrast={setHighContrast}
                largeText={largeText}
                setLargeText={setLargeText}
                palette={palette}
                setPalette={setPalette}
                fontPair={fontPair}
                setFontPair={setFontPair}
                onSaved={showToast}
              />
            )}
          </>
        )}
      </main>

      {(route.name === "home" || route.name === "all") && hydrated && (
        <button
          className="fab"
          onClick={() => go("addCustomer")}
          aria-label="Add new customer"
        >
          ＋ Add New Customer
        </button>
      )}

      <div
        className={`toast ${toast ? "show" : ""}`}
        role="status"
        aria-live="polite"
      >
        {toast}
      </div>

      {dialog && (
        <ModalDialog
          title={dialog.title}
          message={dialog.message}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

/* ---------------- Drawer ---------------- */

function Drawer({ open, route, onClose, onGo }) {
  const items = [
    { name: "home", label: "Home", glyph: "⌂", desc: "Recent customers" },
    {
      name: "addCustomer",
      label: "Add Customer",
      glyph: "＋",
      desc: "New client",
    },
    {
      name: "settings",
      label: "Settings",
      glyph: "⚙",
      desc: "Colours and fonts",
    },
  ];
  return (
    <>
      <div
        className={`scrim ${open ? "open" : ""}`}
        onClick={onClose}
        aria-hidden={!open}
      />
      <aside
        className={`drawer ${open ? "open" : ""}`}
        aria-label="Main navigation"
        aria-hidden={!open}
      >
        <div className="drawer-head">
          <div>
            <strong>Priyaa</strong>
            <span>Measurement Book</span>
          </div>
        </div>
        <nav>
          {items.map((it) => (
            <button
              key={it.name}
              className={`drawer-link ${route.name === it.name ? "active" : ""}`}
              onClick={() => onGo(it.name)}
              aria-current={route.name === it.name ? "page" : undefined}
            >
              <span className="glyph" aria-hidden="true">
                {it.glyph}
              </span>
              <span>
                {it.label}
                <br />
                <small style={{ color: "var(--muted)", fontWeight: 400 }}>
                  {it.desc}
                </small>
              </span>
            </button>
          ))}
        </nav>
        <div className="drawer-foot">
          Measurements, orders &amp; due dates in one place.
        </div>
      </aside>
    </>
  );
}

/* ---------------- Home ---------------- */

function HomeScreen({
  customers,
  title,
  subtitle,
  search,
  setSearch,
  onOpen,
  unit,
}) {
  return (
    <>
      <h1>{title}</h1>
      <p className="subtitle">{subtitle}</p>
      <label htmlFor="search" style={{ fontWeight: 800 }}>
        Search
      </label>
      <input
        id="search"
        className="search"
        type="search"
        placeholder="Search name, number, or garment…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search customers"
      />
      {customers.length === 0 ? (
        <div className="empty">
          <p style={{ fontSize: 20, fontWeight: 800, color: "var(--text)" }}>
            No customers found
          </p>
          <p>Try a different search.</p>
        </div>
      ) : (
        <div className="customer-grid">
          {customers.map((c) => {
            const upcoming = upcomingOrder(c);
            return (
              <div
                key={c.id}
                className="customer-card"
                role="button"
                tabIndex={0}
                onClick={() => onOpen(c.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen(c.id);
                  }
                }}
                aria-label={`Open ${c.name}`}
              >
                <p className="name">{c.name}</p>
                <p className="row">
                  <span aria-hidden="true">☎</span> {c.mobile}
                </p>
                <p className="row">
                  <span aria-hidden="true">✂</span>{" "}
                  {upcoming
                    ? upcoming.garmentLabel
                    : c.orders.length
                      ? "All orders handed over"
                      : "No orders yet"}
                </p>
                <div className="meta-row pill-row">
                  {upcoming && (
                    <button
                      type="button"
                      className={`pill ${statusClass(upcoming.status)}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(c.id, "orders");
                      }}
                    >
                      Due {formatDate(upcoming.deliveryDate)} ·{" "}
                      {upcoming.status}
                    </button>
                  )}
                  <button
                    type="button"
                    className="pill"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(c.id, "orders");
                    }}
                  >
                    {c.orders.length} order{c.orders.length === 1 ? "" : "s"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="subtitle" style={{ marginTop: 16 }}>
        All sizes shown in {unit === "inch" ? "inches" : "cm"}.
      </p>
    </>
  );
}

/* ---------------- Customer Detail ---------------- */

function CustomerDetailScreen({
  customer,
  unit,
  focusOrders = false,
  onBack,
  onEdit,
  onUpdateOrder,
  onAddMeasurement,
}) {
  const ordersRef = useRef(null);
  const [editing, setEditing] = useState(false);
  const [editingOrder, setEditingOrder] = useState(null);
  const [imageViewer, setImageViewer] = useState(null);
  const [openOrder, setOpenOrder] = useState(customer.orders[0]?.id || null);
  const [form, setForm] = useState({
    name: customer.name,
    mobile: customer.mobile,
    address: customer.address,
    notes: customer.notes,
  });
  const [editTouched, setEditTouched] = useState(false);

  useEffect(() => {
    if (focusOrders && ordersRef.current) {
      ordersRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [focusOrders, customer.id]);

  const nameErr =
    editTouched && !form.name.trim()
      ? "Please enter the customer name."
      : editTouched && form.name.trim().length > 10
        ? "Name must be 50 characters or fewer."
        : "";
  const mobileErr =
    editTouched && !form.mobile.trim()
      ? "Please enter the mobile number."
      : editTouched && !isValidMobile(form.mobile)
        ? "Mobile number must be 10 digits."
        : "";

  const saveEdit = () => {
    setEditTouched(true);
    if (!isValidName(form.name) || !isValidMobile(form.mobile)) return;
    onEdit({
      ...form,
      name: form.name.trim(),
      mobile: digitsOnly(form.mobile),
    });
    setEditing(false);
  };

  return (
    <>
      <button className="back-btn" onClick={onBack} aria-label="Back to home">
        ← Back
      </button>
      <h1>{customer.name}</h1>
      <p className="subtitle">
        Customer details, garment orders &amp; measurements.
      </p>

      <section className="profile" aria-label="Customer information">
        {!editing ? (
          <>
            <h2>{customer.name}</h2>
            <p className="phone">☎ {customer.mobile}</p>
            <p>{customer.address || "No address added"}</p>
            {customer.notes && <p>Note: {customer.notes}</p>}
            <div className="btn-row">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setForm({
                    name: customer.name,
                    mobile: customer.mobile,
                    address: customer.address,
                    notes: customer.notes,
                  });
                  setEditTouched(false);
                  setEditing(true);
                }}
              >
                Edit Details
              </button>
              <button className="btn btn-primary" onClick={onAddMeasurement}>
                ＋ Add Garment
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor="edit-name">
                Name *{" "}
                <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                  (max 50 characters)
                </span>
              </label>
              <input
                id="edit-name"
                className="text-input"
                maxLength={50}
                value={form.name}
                onChange={(e) =>
                  setForm({ ...form, name: e.target.value.slice(0, 50) })
                }
              />
              {nameErr && (
                <p className="error" role="alert">
                  {nameErr}
                </p>
              )}
            </div>
            <div className="field">
              <label htmlFor="edit-mobile">
                Mobile number *{" "}
                <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                  (10 digits)
                </span>
              </label>
              <input
                id="edit-mobile"
                className="text-input"
                inputMode="tel"
                maxLength={10}
                value={form.mobile}
                onChange={(e) =>
                  setForm({
                    ...form,
                    mobile: digitsOnly(e.target.value).slice(0, 10),
                  })
                }
              />
              {mobileErr && (
                <p className="error" role="alert">
                  {mobileErr}
                </p>
              )}
            </div>
            <div className="field">
              <label htmlFor="edit-addr">Address</label>
              <input
                id="edit-addr"
                className="text-input"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="edit-notes">Notes</label>
              <textarea
                id="edit-notes"
                className="text-area"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
            <div className="btn-row">
              <button
                className="btn btn-secondary"
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
              <button className="btn btn-primary" onClick={saveEdit}>
                Save Changes
              </button>
            </div>
          </>
        )}
      </section>

      <h2 className="section-title" ref={ordersRef}>
        Garment Orders ({customer.orders.length})
      </h2>
      {customer.orders.length === 0 && (
        <div className="empty">
          <p>No garments yet. Tap “Add Garment” to start.</p>
        </div>
      )}
      {customer.orders.map((o) => {
        const open = openOrder === o.id;
        const hasPayment = o.totalAmount != null || o.advancePaid != null;
        const balance = (o.totalAmount || 0) - (o.advancePaid || 0);
        return (
          <div className="garment-card" key={o.id}>
            <button
              className="garment-head"
              onClick={() => setOpenOrder(open ? null : o.id)}
              aria-expanded={open}
            >
              <span>{o.garmentLabel}</span>
              <span className="chev" aria-hidden="true">
                {open ? "▾" : "▸"}
              </span>
            </button>
            {open && (
              <div>
                {editingOrder === o.id ? (
                  <OrderEditForm
                    order={o}
                    unit={unit}
                    onCancel={() => setEditingOrder(null)}
                    onSave={async (fields, options) => {
                      await onUpdateOrder(o.id, fields, options);
                      setEditingOrder(null);
                    }}
                  />
                ) : (
                  <>
                    <div
                      className="pill-row"
                      style={{ padding: "0 18px 12px" }}
                    >
                      <span className={`pill ${statusClass(o.status)}`}>
                        {o.status}
                      </span>
                      <span className="pill">{formatDate(o.deliveryDate)}</span>
                      {hasPayment &&
                        (o.status === "Hand Over" ? (
                          <span className="pill status-ready">
                            Paid {formatMoney(o.advancePaid ?? o.totalAmount)}
                          </span>
                        ) : (
                          <>
                            {o.totalAmount != null && (
                              <span className="pill">
                                Total {formatMoney(o.totalAmount)}
                              </span>
                            )}
                            {o.advancePaid != null && (
                              <span className="pill status-progress">
                                Advance {formatMoney(o.advancePaid)}
                              </span>
                            )}
                            {o.totalAmount != null && (
                              <span
                                className={`pill ${balance > 0 ? "status-new" : "status-ready"}`}
                              >
                                Balance {formatMoney(balance)}
                              </span>
                            )}
                          </>
                        ))}
                    </div>
                    {(o.referenceImages || []).length > 0 && (
                      <div
                        className="reference-images"
                        aria-label={`Reference images for ${o.garmentLabel}`}
                      >
                        {o.referenceImages.map((url, i) => (
                          <button
                            type="button"
                            key={`${url}-${i}`}
                            className="reference-image"
                            onClick={() =>
                              setImageViewer({
                                images: o.referenceImages,
                                index: i,
                                title: `${o.garmentLabel} reference images`,
                              })
                            }
                            aria-label={`View reference image ${i + 1} for ${o.garmentLabel}`}
                          >
                            <img
                              src={url}
                              alt={`Reference ${i + 1} for ${o.garmentLabel}`}
                            />
                          </button>
                        ))}
                      </div>
                    )}
                    <div
                      className="measure-view"
                      aria-label={`Measurements for ${o.garmentLabel}`}
                    >
                      {Object.entries(o.measurements || {}).map(([k, v]) => (
                        <div className="measure-view-item" key={k}>
                          <span className="k">{displayMeasurementName(k)}</span>
                          <span className="v">
                            {v}{" "}
                            <span className="unit">
                              {unit === "inch" ? "in" : "cm"}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="order-actions">
                      <button
                        className="btn btn-secondary"
                        onClick={() => setEditingOrder(o.id)}
                      >
                        Edit Order
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
      {imageViewer && (
        <ImageViewer
          images={imageViewer.images}
          initialIndex={imageViewer.index}
          title={imageViewer.title}
          onClose={() => setImageViewer(null)}
        />
      )}
    </>
  );
}

/* ---------------- Edit Order ---------------- */

function ModalDialog({
  title,
  message,
  onClose,
  alert = false,
  confirmLabel = "OK",
  onConfirm,
  cancelLabel,
  onCancel,
}) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog"
        role={alert ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby="dialog-message"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="dialog-title" className="dialog-title">
          {title}
        </h2>
        <p id="dialog-message">{message}</p>
        <div className="btn-row">
          {cancelLabel && (
            <button className="btn btn-secondary" onClick={onCancel || onClose}>
              {cancelLabel}
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={onConfirm || onClose}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function ImageViewer({ images, initialIndex = 0, title = "Reference images", onClose }) {
  const [index, setIndex] = useState(initialIndex);
  const count = images.length;

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (count < 2) return;
      if (e.key === "ArrowLeft") setIndex((i) => (i - 1 + count) % count);
      if (e.key === "ArrowRight") setIndex((i) => (i + 1) % count);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count, onClose]);

  if (!count) return null;

  const go = (step) => setIndex((i) => (i + step + count) % count);

  return (
    <div className="viewer-overlay" onClick={onClose}>
      <div
        className="viewer"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="viewer-bar">
          <strong>{title}</strong>
          <span className="viewer-count">
            {index + 1} / {count}
          </span>
          <button
            type="button"
            className="viewer-close"
            onClick={onClose}
            aria-label="Close image viewer"
            autoFocus
          >
            ×
          </button>
        </div>
        <div className="viewer-stage">
          <img src={images[index]} alt={`${title} ${index + 1}`} />
          {count > 1 && (
            <>
              <button
                type="button"
                className="viewer-nav viewer-prev"
                onClick={() => go(-1)}
                aria-label="Previous image"
              >
                ‹
              </button>
              <button
                type="button"
                className="viewer-nav viewer-next"
                onClick={() => go(1)}
                aria-label="Next image"
              >
                ›
              </button>
            </>
          )}
        </div>
        {count > 1 && (
          <div className="viewer-thumbs">
            {images.map((src, i) => (
              <button
                type="button"
                key={`${src}-${i}`}
                className={`viewer-thumb${i === index ? " active" : ""}`}
                onClick={() => setIndex(i)}
                aria-label={`View image ${i + 1}`}
                aria-current={i === index ? "true" : undefined}
              >
                <img src={src} alt="" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function OrderEditForm({ order, unit, onCancel, onSave }) {
  const templateFields = MEASUREMENT_TEMPLATES[order.garment] || [];
  const initialImages = order.referenceImages || [];
  const [deliveryDate, setDeliveryDate] = useState(order.deliveryDate || "");
  const [status, setStatus] = useState(order.status || ORDER_STATUSES[0]);
  const [values, setValues] = useState(
    () => splitMeasurements(order.measurements, templateFields).standard,
  );
  const [customs, setCustoms] = useState(
    () => splitMeasurements(order.measurements, templateFields).customs,
  );
  const [referenceImages, setReferenceImages] = useState(initialImages);
  const [imageFiles, setImageFiles] = useState([]);
  const [imageMsg, setImageMsg] = useState("");
  const [uploading, setUploading] = useState(false);
  const [touched, setTouched] = useState(false);
  const [warning, setWarning] = useState("");

  const imagePreviews = useMemo(
    () => imageFiles.map((file) => URL.createObjectURL(file)),
    [imageFiles],
  );
  useEffect(
    () => () => imagePreviews.forEach((url) => URL.revokeObjectURL(url)),
    [imagePreviews],
  );

  const fields = templateFields;
  const statusOptions = ORDER_STATUSES.includes(status)
    ? ORDER_STATUSES
    : [status, ...ORDER_STATUSES];
  const isHandedOver = order.status === "Hand Over";
  const todayIso = toDateInputValue(new Date());
  const balance =
    Number(order.totalAmount || 0) - Number(order.advancePaid || 0);
  const dateErr =
    touched && !isHandedOver && !deliveryDate
      ? "Please choose a delivery date."
      : touched && !isHandedOver && deliveryDate < todayIso
        ? "Delivery date cannot be in the past."
        : "";
  const incompleteCustoms = hasIncompleteCustoms(customs);
  const invalidCustoms = !isValidCustoms(customs);
  const customErr = touched && incompleteCustoms
    ? "Enter a text-only name and a value greater than 0 for each custom field."
    : touched && invalidCustoms
      ? "Use up to 2 digits before and after the decimal."
      : "";

  const cleanMeasurements = () => mergeMeasurements(values, customs);
  const cleanedMeasurements = cleanMeasurements();
  const noMeasurements = Object.keys(cleanedMeasurements).length === 0;
  const measurementErr =
    touched && noMeasurements ? "Please keep at least one measurement value." : "";

  const imageCount = referenceImages.length + imageFiles.length;

  const addImages = (event) => {
    const picked = Array.from(event.target.files || []);
    const valid = picked.filter(
      (file) => file.type.startsWith("image/") && file.size <= 5 * 1024 * 1024,
    );
    if (valid.length !== picked.length)
      setImageMsg("Use image files under 5 MB.");
    else if (picked.length > 2 - imageCount) setImageMsg("Maximum 2 images.");
    else setImageMsg("");
    setImageFiles((prev) =>
      [...prev, ...valid].slice(0, 2 - referenceImages.length),
    );
    event.target.value = "";
  };

  const imageChanges = () => ({ imageFiles });

  const save = async () => {
    setTouched(true);
    if (!isHandedOver && (!deliveryDate || deliveryDate < todayIso)) return;
    if (incompleteCustoms || invalidCustoms || noMeasurements) return;
    if (!isHandedOver && status === "Hand Over" && balance > 0) {
      setWarning(
        `There is a balance of ${formatMoney(balance)} pending with this garment. Do you want to proceed? Choosing yes will clear the balance and hand it over.`,
      );
      return;
    }
    setUploading(true);
    await onSave(
      isHandedOver
        ? { measurements: cleanedMeasurements }
        : {
            deliveryDate,
            status,
            measurements: cleanedMeasurements,
            referenceImages,
          },
      isHandedOver ? undefined : imageChanges(),
    );
  };

  const confirmHandover = async () => {
    setWarning("");
    setUploading(true);
    await onSave(
      {
        deliveryDate,
        status: "Hand Over",
        measurements: cleanMeasurements(),
        advancePaid: order.totalAmount,
        referenceImages,
      },
      imageChanges(),
    );
  };

  const cancelHandover = () => {
    setWarning("");
    setStatus(order.status || ORDER_STATUSES[0]);
  };

  return (
    <div className="order-edit">
      <div className="edit-meta-grid">
        {isHandedOver ? (
          <>
            <div className="field">
              <span className="field-label">Delivery date</span>
              <p className="locked-value">{formatDate(order.deliveryDate)}</p>
            </div>

            <div className="field">
              <span className="field-label">Status</span>
              <p className="locked-value">{order.status}</p>
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor={`oe-date-${order.id}`}>Delivery date</label>
              <input
                id={`oe-date-${order.id}`}
                className="text-input"
                type="date"
                min={todayIso}
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
              />
              {dateErr && (
                <p className="error" role="alert">
                  {dateErr}
                </p>
              )}
            </div>

            <div className="field">
              <label htmlFor={`oe-status-${order.id}`}>Status</label>
              <select
                id={`oe-status-${order.id}`}
                className="text-input"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {statusOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              {balance > 0 && (
                <p className="hint">
                  Balance {formatMoney(balance)} pending — clear it before
                  handover.
                </p>
              )}
            </div>
          </>
        )}
      </div>
      {isHandedOver && (
        <p className="locked-note">
          Handed over — delivery date and status are locked. Garment values can
          still be edited for future reference.
        </p>
      )}

      {isHandedOver ? (
        <div className="field">
          <span className="field-label">Reference images</span>
          {referenceImages.length > 0 ? (
            <div className="image-previews">
              {referenceImages.map((url, i) => (
                <div className="image-preview" key={url}>
                  <img src={url} alt={`Reference ${i + 1}`} />
                </div>
              ))}
            </div>
          ) : (
            <p className="hint">No reference images.</p>
          )}
          <p className="hint">Images are locked after handover.</p>
        </div>
      ) : (
        <div className="field">
          <label htmlFor={`oe-images-${order.id}`}>
            Reference images{" "}
            <span style={{ color: "var(--muted)", fontWeight: 400 }}>
              (max 2)
            </span>
          </label>
          {imageCount > 0 && (
            <div className="image-previews">
              {referenceImages.map((url, i) => (
                <div className="image-preview" key={url}>
                  <img src={url} alt={`Reference ${i + 1}`} />
                  <button
                    type="button"
                    className="image-remove"
                    onClick={() =>
                      setReferenceImages((prev) =>
                        prev.filter((_, idx) => idx !== i),
                      )
                    }
                    aria-label={`Remove reference image ${i + 1}`}
                  >
                    ×
                  </button>
                </div>
              ))}
              {imageFiles.map((file, i) => (
                <div className="image-preview" key={`${file.name}-${i}`}>
                  <img src={imagePreviews[i]} alt={`New reference ${i + 1}`} />
                  <button
                    type="button"
                    className="image-remove"
                    onClick={() => {
                      setImageFiles((prev) =>
                        prev.filter((_, idx) => idx !== i),
                      );
                      setImageMsg("");
                    }}
                    aria-label={`Remove new image ${i + 1}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <input
            id={`oe-images-${order.id}`}
            className="text-input"
            type="file"
            accept="image/*"
            multiple
            onChange={addImages}
            disabled={imageCount >= 2}
          />
          <p className="hint">
            Tap × to remove an image, then choose another. Maximum 2 images.
          </p>
          {imageMsg && (
            <p className="error" role="alert">
              {imageMsg}
            </p>
          )}
        </div>
      )}

      <div className="field">
        <label>
          Garment values{" "}
          <span style={{ color: "var(--muted)", fontWeight: 400 }}>
            ({unit === "inch" ? "inches" : "cm"})
          </span>
        </label>
        <div className="measure-grid">
          {fields.map((f) => (
            <div className="measure-row" key={f}>
              <label htmlFor={`oe-${order.id}-${f}`}>{f}</label>
              <span className="with-unit">
                <input
                  id={`oe-${order.id}-${f}`}
                  inputMode="decimal"
                  type="text"
                  placeholder="0"
                  value={values[f] || ""}
                  onChange={(e) =>
                    setValues({
                      ...values,
                      [f]: sanitizeMeasurement(e.target.value),
                    })
                  }
                  aria-label={`${f} in ${unit === "inch" ? "inches" : "cm"}`}
                />
                <span className="unit-label">
                  {unit === "inch" ? "in" : "cm"}
                </span>
              </span>
            </div>
          ))}
          <CustomMeasurements
            customs={customs}
            unit={unit}
            onChange={(i, field, value) =>
              setCustoms((prev) =>
                prev.map((custom, idx) =>
                  idx === i ? { ...custom, [field]: value } : custom,
                ),
              )
            }
            onAdd={() =>
              setCustoms((prev) =>
                prev.length < 2 ? [...prev, { name: "", value: "" }] : prev,
              )
            }
            onRemove={(i) =>
              setCustoms((prev) => prev.filter((_, idx) => idx !== i))
            }
          />
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          Up to 2 digits before and after the decimal.
        </p>
        {customErr && (
          <p className="error" role="alert">
            {customErr}
          </p>
        )}
        {measurementErr && (
          <p className="error" role="alert">
            {measurementErr}
          </p>
        )}
      </div>

      <div className="btn-row">
        <button
          className="btn btn-secondary"
          onClick={onCancel}
          disabled={uploading}
        >
          Cancel
        </button>
        <button className="btn btn-primary" onClick={save} disabled={uploading}>
          {uploading ? "Saving…" : "Save Order"}
        </button>
      </div>
      {warning && (
        <ModalDialog
          title="Balance pending"
          message={warning}
          onClose={cancelHandover}
          onCancel={cancelHandover}
          cancelLabel="No, cancel"
          confirmLabel="Yes, proceed"
          onConfirm={confirmHandover}
          alert
        />
      )}
    </div>
  );
}

/* ---------------- Add Customer ---------------- */

function AddCustomerScreen({ onBack, onSave }) {
  const [form, setForm] = useState({
    name: "",
    mobile: "",
    address: "",
    notes: "",
  });
  const [touched, setTouched] = useState(false);
  const nameErr =
    touched && !form.name.trim()
      ? "Please enter the customer name."
      : touched && form.name.trim().length > 10
        ? "Name must be 50 characters or fewer."
        : "";
  const mobileErr =
    touched && !form.mobile.trim()
      ? "Please enter the mobile number."
      : touched && !isValidMobile(form.mobile)
        ? "Mobile number must be 10 digits."
        : "";

  const submit = () => {
    setTouched(true);
    if (!isValidName(form.name) || !isValidMobile(form.mobile)) return;
    onSave({
      ...form,
      name: form.name.trim(),
      mobile: digitsOnly(form.mobile),
    });
  };

  return (
    <>
      <button className="back-btn" onClick={onBack} aria-label="Back to home">
        ← Back
      </button>
      <h1>Add New Customer</h1>
      <p className="subtitle">
        Name up to 50 characters and a 10-digit mobile are required.
      </p>
      <div className="card">
        <div className="field">
          <label htmlFor="nc-name">
            Full name *{" "}
            <span style={{ color: "var(--muted)", fontWeight: 400 }}>
              (max 50 characters)
            </span>
          </label>
          <input
            id="nc-name"
            className="text-input"
            placeholder="e.g. Priyaa"
            maxLength={50}
            value={form.name}
            onChange={(e) =>
              setForm({ ...form, name: e.target.value.slice(0, 50) })
            }
            autoComplete="name"
          />
          {nameErr && (
            <p className="error" role="alert">
              {nameErr}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="nc-mobile">
            Mobile number *{" "}
            <span style={{ color: "var(--muted)", fontWeight: 400 }}>
              (10 digits)
            </span>
          </label>
          <input
            id="nc-mobile"
            className="text-input"
            placeholder="e.g. 8124266812"
            inputMode="tel"
            maxLength={10}
            value={form.mobile}
            onChange={(e) =>
              setForm({
                ...form,
                mobile: digitsOnly(e.target.value).slice(0, 10),
              })
            }
            autoComplete="tel"
          />
          {mobileErr && (
            <p className="error" role="alert">
              {mobileErr}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="nc-addr">Address</label>
          <input
            id="nc-addr"
            className="text-input"
            placeholder="D2 1104"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="nc-notes">Notes</label>
          <textarea
            id="nc-notes"
            className="text-area"
            placeholder="Fit preference, fabric, loose fit ..."
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
          <p className="hint">Example: “Prefers loose fit, cotton only.”</p>
        </div>
        <div className="btn-row">
          <button className="btn btn-secondary" onClick={onBack}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit}>
            Save Customer
          </button>
        </div>
      </div>
    </>
  );
}

/* ---------------- Add Garment ---------------- */

const GARMENT_ICONS = {
  blouse: (
    <>
      <path d="M24 12 L15 18 L9 33 L16 37 L20 28 L20 52 L44 52 L44 28 L48 37 L55 33 L49 18 L40 12 L32 21 Z" />
      <path d="M25 40 L25 46 M39 40 L39 46" />
    </>
  ),
  salwar: (
    <>
      <path d="M24 10 L15 16 L11 36 L17 39 L20 27 L20 45 L44 45 L44 27 L47 39 L53 36 L49 16 L40 10 L32 18 Z" />
      <path d="M23 45 L21 56 L30 56 L32 47 L34 56 L43 56 L41 45" />
    </>
  ),
  dress: (
    <>
      <path d="M26 11 L18 15 L14 30 L20 33 L22 26 L19 34 L12 55 L52 55 L45 34 L42 26 L44 33 L50 30 L46 15 L38 11 L32 18 Z" />
      <path d="M19 34 Q32 38 45 34" />
    </>
  ),
  shirt: (
    <>
      <path d="M25 11 L15 15 L8 39 L14 42 L20 30 L20 52 L44 52 L44 30 L50 42 L56 39 L49 15 L39 11 L32 18 Z" />
      <path d="M32 18 V52" />
      <path d="M27 11 L32 18 L37 11" />
    </>
  ),
  pants: (
    <>
      <path d="M20 12 H44 L46 54 L35 54 L32 32 L29 54 L18 54 Z" />
      <path d="M20 19 H44" />
    </>
  ),
  skirt: (
    <>
      <path d="M23 13 H41 L53 52 H11 Z" />
      <path d="M23 19 H41" />
      <path d="M27 19 L22 52 M37 19 L42 52" />
    </>
  ),
};

function GarmentIcon({ id }) {
  return (
    <svg
      className="garment-icon"
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {GARMENT_ICONS[id]}
    </svg>
  );
}

function AddMeasurementScreen({ customer, unit, onBack, onSave }) {
  const [garment, setGarment] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(defaultDeliveryDate);
  const [values, setValues] = useState({});
  const [customs, setCustoms] = useState([]);
  const [totalAmount, setTotalAmount] = useState("");
  const [advancePaid, setAdvancePaid] = useState("");
  const [images, setImages] = useState([]);
  const [imageMsg, setImageMsg] = useState("");
  const [uploading, setUploading] = useState(false);
  const [touched, setTouched] = useState(false);

  const previews = useMemo(
    () => images.map((file) => URL.createObjectURL(file)),
    [images],
  );
  useEffect(
    () => () => previews.forEach((url) => URL.revokeObjectURL(url)),
    [previews],
  );

  const fields = MEASUREMENT_TEMPLATES[garment] || [];
  const todayIso = toDateInputValue(new Date());
  const standardFilledCount = fields.filter(
    (f) => String(values[f] || "").trim() !== "",
  ).length;
  const garmentErr = touched && !garment ? "Please choose a garment type." : "";
  const dateErr =
    touched && !deliveryDate
      ? "Please choose a delivery date."
      : touched && deliveryDate < todayIso
        ? "Delivery date cannot be in the past."
        : "";
  const incompleteCustoms = hasIncompleteCustoms(customs);
  const invalidStandard = Object.values(values).some(
    (value) => String(value).trim() !== "" && !isValidMeasurement(value),
  );
  const invalidCustoms = !isValidCustoms(customs);
  const standardErr =
    touched && garment && standardFilledCount === 0
      ? "Please enter at least one measurement value."
      : touched && invalidStandard
        ? "Use up to 2 digits before and after the decimal."
        : "";
  const customErr =
    touched && incompleteCustoms
      ? "Enter a text-only custom name and a value greater than 0 for each custom field."
      : touched && invalidCustoms
        ? "Use up to 2 digits before and after the decimal for custom values."
        : "";
  const totalNum = totalAmount.trim() === "" ? null : Number(totalAmount);
  const advanceNum = advancePaid.trim() === "" ? null : Number(advancePaid);
  const balanceAmount = totalNum == null ? null : totalNum - (advanceNum || 0);

  const addImages = (event) => {
    const picked = Array.from(event.target.files || []);
    const valid = picked.filter(
      (file) => file.type.startsWith("image/") && file.size <= 5 * 1024 * 1024,
    );
    if (valid.length !== picked.length)
      setImageMsg("Use image files under 5 MB.");
    else if (picked.length > 2 - images.length)
      setImageMsg("Maximum 2 images.");
    else setImageMsg("");
    setImages((prev) => [...prev, ...valid].slice(0, 2));
    event.target.value = "";
  };

  const submit = async () => {
    setTouched(true);
    if (
      !garment ||
      !deliveryDate ||
      deliveryDate < todayIso ||
      standardFilledCount === 0 ||
      incompleteCustoms ||
      invalidStandard ||
      invalidCustoms
    )
      return;
    const merged = mergeMeasurements(values, customs);
    setUploading(true);
    await onSave(
      customer.id,
      garment,
      deliveryDate,
      merged,
      {
        totalAmount: totalAmount.trim() === "" ? null : Number(totalAmount),
        advancePaid: advancePaid.trim() === "" ? null : Number(advancePaid),
      },
      images,
    );
  };

  return (
    <>
      <button
        className="back-btn"
        onClick={onBack}
        aria-label={`Back to ${customer.name}`}
      >
        ← {customer.name}
      </button>
      <h1>Add Garment</h1>
      <p className="subtitle">
        For <strong>{customer.name}</strong> · {customer.mobile}
      </p>

      <div className="card">
        <div className="field">
          <label id="garment-label">1. Choose garment type</label>
          <div
            className="seg-grid"
            role="group"
            aria-labelledby="garment-label"
          >
            {GARMENT_TYPES.map((g) => (
              <button
                key={g.id}
                className={`seg ${garment === g.id ? "selected" : ""}`}
                onClick={() => {
                  setGarment(g.id);
                  setValues({});
                }}
                aria-pressed={garment === g.id}
              >
                <GarmentIcon id={g.id} />
                <span className="seg-label">{g.label}</span>
              </button>
            ))}
          </div>
          {garmentErr && (
            <p className="error" role="alert">
              {garmentErr}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="m-images">
            2. Reference images{" "}
            <span style={{ color: "var(--muted)", fontWeight: 400 }}>
              (optional, max 2)
            </span>
          </label>
          <input
            id="m-images"
            className="text-input"
            type="file"
            accept="image/*"
            multiple
            onChange={addImages}
          />
          <p className="hint">Images up to 5 MB each. Tap × to remove one.</p>
          {imageMsg && (
            <p className="error" role="alert">
              {imageMsg}
            </p>
          )}
          {images.length > 0 && (
            <div className="image-previews">
              {images.map((file, i) => (
                <div className="image-preview" key={`${file.name}-${i}`}>
                  <img src={previews[i]} alt={`Reference ${i + 1}`} />
                  <button
                    type="button"
                    className="image-remove"
                    onClick={() => {
                      setImages((prev) => prev.filter((_, idx) => idx !== i));
                      setImageMsg("");
                    }}
                    aria-label={`Remove image ${i + 1}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="field">
          <label>
            3. Enter values{" "}
            <span style={{ color: "var(--muted)", fontWeight: 400 }}>
              ({unit === "inch" ? "inches" : "cm"})
            </span>
          </label>
          <p className="hint" style={{ marginTop: 0 }}>
            Up to 2 digits before and after the decimal (e.g. 42, 13.5, 42.55).
          </p>
          <div className="measure-grid">
            {fields.map((f) => (
              <div className="measure-row" key={f}>
                <label htmlFor={`m-${f}`}>{f}</label>
                <span className="with-unit">
                  <input
                    id={`m-${f}`}
                    inputMode="decimal"
                    type="text"
                    placeholder="0"
                    value={values[f] || ""}
                    onChange={(e) =>
                      setValues({
                        ...values,
                        [f]: sanitizeMeasurement(e.target.value),
                      })
                    }
                    aria-label={`${f} in ${unit === "inch" ? "inches" : "cm"}`}
                  />
                  <span className="unit-label">
                    {unit === "inch" ? "in" : "cm"}
                  </span>
                </span>
              </div>
            ))}
            {garment && (
              <CustomMeasurements
                customs={customs}
                unit={unit}
                onChange={(i, field, value) =>
                  setCustoms((prev) =>
                    prev.map((custom, idx) =>
                      idx === i ? { ...custom, [field]: value } : custom,
                    ),
                  )
                }
                onAdd={() =>
                  setCustoms((prev) =>
                    prev.length < 2 ? [...prev, { name: "", value: "" }] : prev,
                  )
                }
                onRemove={(i) =>
                  setCustoms((prev) => prev.filter((_, idx) => idx !== i))
                }
              />
            )}
          </div>
          {garment && (
            <p className="hint" style={{ marginTop: 8, marginBottom: 0 }}>
              Custom measurements — up to 2. Names accept text only.
            </p>
          )}
          {standardErr && (
            <p className="error" role="alert">
              {standardErr}
            </p>
          )}
          {customErr && (
            <p className="error" role="alert">
              {customErr}
            </p>
          )}
        </div>

        <div className="field">
          <label>
            4. Payment{" "}
            <span style={{ color: "var(--muted)", fontWeight: 400 }}>
              (optional)
            </span>
          </label>
          <div className="measure-row">
            <label htmlFor="m-total">Total amount</label>
            <span className="with-unit">
              <input
                id="m-total"
                inputMode="decimal"
                type="number"
                min="0"
                step="1"
                placeholder="0"
                value={totalAmount}
                onChange={(e) => setTotalAmount(e.target.value)}
                aria-label="Total amount in rupees"
              />
              <span className="unit-label">₹</span>
            </span>
          </div>
          <div className="measure-row">
            <label htmlFor="m-advance">Advance paid</label>
            <span className="with-unit">
              <input
                id="m-advance"
                inputMode="decimal"
                type="number"
                min="0"
                step="1"
                placeholder="0"
                value={advancePaid}
                onChange={(e) => setAdvancePaid(e.target.value)}
                aria-label="Advance paid in rupees"
              />
              <span className="unit-label">₹</span>
            </span>
          </div>
          <div className="measure-row">
            <label htmlFor="m-balance">Balance</label>
            <span className="with-unit">
              <input
                id="m-balance"
                type="text"
                readOnly
                value={
                  balanceAmount == null
                    ? ""
                    : Number(balanceAmount).toLocaleString("en-IN")
                }
                placeholder="0"
                aria-label="Balance amount in rupees (calculated)"
                aria-readonly="true"
              />
              <span className="unit-label">₹</span>
            </span>
          </div>
          <p className="hint">Balance is calculated automatically.</p>
        </div>

        <div className="field">
          <label htmlFor="m-date">5. Delivery date</label>
          <input
            id="m-date"
            className="text-input"
            type="date"
            min={todayIso}
            value={deliveryDate}
            onChange={(e) => setDeliveryDate(e.target.value)}
          />
          {dateErr && (
            <p className="error" role="alert">
              {dateErr}
            </p>
          )}
        </div>

        <div className="btn-row">
          <button
            className="btn btn-secondary"
            onClick={onBack}
            disabled={uploading}
          >
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={submit}
            disabled={uploading}
          >
            {uploading ? "Uploading…" : "Save Garment"}
          </button>
        </div>
      </div>
    </>
  );
}

/* ---------------- Settings ---------------- */

function SettingsScreen({
  onBack,
  highContrast,
  setHighContrast,
  largeText,
  setLargeText,
  palette,
  setPalette,
  fontPair,
  setFontPair,
  onSaved,
}) {
  return (
    <>
      <button className="back-btn" onClick={onBack} aria-label="Back to home">
        ← Back
      </button>
      <h1>Settings</h1>
      <p className="subtitle">
        Try looks below — everything changes instantly. Keep what feels easiest.
      </p>

      <div className="card">
        <div className="field">
          <label id="palette-label">Color palette (tap to preview)</label>
          <div
            className="swatch-grid"
            role="group"
            aria-labelledby="palette-label"
          >
            {THEMES.map((t) => (
              <button
                key={t.id}
                className={`swatch ${palette === t.id ? "selected" : ""}`}
                onClick={() => {
                  setPalette(t.id);
                  onSaved(`${t.name} palette applied`);
                }}
                aria-pressed={palette === t.id}
              >
                <span className="dots" aria-hidden="true">
                  {t.dots.map((d) => (
                    <i key={d} style={{ background: d }} />
                  ))}
                </span>
                <span>
                  <strong>
                    {t.name}
                    {palette === t.id ? " ✓" : ""}
                  </strong>
                  <small>{t.why}</small>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label id="font-label">Heading + body fonts (tap to preview)</label>
          <div className="font-grid" role="group" aria-labelledby="font-label">
            {FONT_PAIRINGS.map((f) => (
              <button
                key={f.id}
                className={`font-card ${fontPair === f.id ? "selected" : ""}`}
                onClick={() => {
                  setFontPair(f.id);
                  onSaved(`${f.name} fonts applied`);
                }}
                aria-pressed={fontPair === f.id}
              >
                <span className="preview-head" style={{ fontFamily: f.head }}>
                  {f.name}
                  {fontPair === f.id ? " ✓" : ""}
                </span>
                <br />
                <span className="preview-body" style={{ fontFamily: f.body }}>
                  Meena Krishnan — Blouse, Chest 36 in, due 12 Sep
                </span>
                <br />
                <small>{f.detail}</small>
              </button>
            ))}
          </div>
          <p className="hint">
            “Classic Tailor” pairs sans-serif headings with a serif body —
            elegant on paper, but serif numbers (36, 13.5) scan slightly slower
            on screen. For daily stitching work, a full sans-serif (“Rounded
            Friendly” or “Extra Clear”) is usually faster to read.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="switch-row">
          <span>
            High-contrast mode
            <br />
            <small style={{ color: "var(--muted)", fontWeight: 400 }}>
              Darker text, stronger borders
            </small>
          </span>
          <button
            className="switch"
            role="switch"
            aria-checked={highContrast}
            aria-label="High contrast mode"
            onClick={() => {
              setHighContrast(!highContrast);
              onSaved(!highContrast ? "High contrast on" : "High contrast off");
            }}
          />
        </div>
        <div className="switch-row">
          <span>
            Large text
            <br />
            <small style={{ color: "var(--muted)", fontWeight: 400 }}>
              Bigger letters everywhere
            </small>
          </span>
          <button
            className="switch"
            role="switch"
            aria-checked={largeText}
            aria-label="Large text"
            onClick={() => {
              setLargeText(!largeText);
              onSaved(!largeText ? "Large text on" : "Large text off");
            }}
          />
        </div>
        <p className="hint" style={{ marginTop: 18 }}>
          Voice-over &amp; screen-reader labels are built in. All buttons are at
          least 56px tall for easy tapping.
        </p>
      </div>
    </>
  );
}
