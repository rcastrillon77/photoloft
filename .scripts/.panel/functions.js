// =======================
// FUNCTIONS
// =======================

// GET EVENTS
async function fetchUpcomingEvents() {
    const now = DateTime.now().setZone(TIMEZONE).minus({ minutes: 30 });
    const in24h = DateTime.now().setZone(TIMEZONE).plus({ hours: 24 });
  
    const { data, error } = await window.supabase
      .from("events")
      .select("uuid, start, end, location_id, listing_id")
      .eq("location_id", LOCATION_UUID)
      .eq("type", "booking")
      .eq("status", "confirmed")
      .gte("end", now.toISO())
      .lte("end", in24h.toISO())
      .order("start", { ascending: true });
  
    if (error) {
      console.error("❌ Failed to fetch events:", error);
      return [];
    }
  
    console.log("📅 Events in next 24 hours:", data);
    return data;
}
  
async function fetchBookingsForEvents(eventUUIDs = []) {
    if (!eventUUIDs.length) return [];
  
    const { data, error } = await window.supabase
      .from("bookings")
      .select("uuid, event_id, details, user_id, transaction_id, entry_code, checkout_completed")
      .overlaps("event_id", eventUUIDs); // array overlap match
  
    if (error) {
      console.error("❌ Failed to fetch bookings for events:", error);
      return [];
    }
  
    console.log("📦 Bookings linked to events:", data);
    return data;
}

function renderCurrentBooking(bookingDetails, bookingUuid, event) {
    if (!bookingDetails) return;
  
    const start = DateTime.fromISO(bookingDetails.start, { zone: TIMEZONE });
    const end = DateTime.fromISO(bookingDetails.end, { zone: TIMEZONE });
    const user = bookingDetails.user || {};
    const listing = bookingDetails.listing || {};
  
    document.getElementById("guest-name").textContent = `${user.first_name || ""}`;
    document.getElementById("start").textContent = `${start.toFormat("h:mm a")}`;
    document.getElementById("end").textContent = `${end.toFormat("h:mm a")}`;
    document.getElementById("listing-name").textContent = listing.name || "Photoloft";

    startBookingCountdown(bookingDetails.start, bookingDetails.end);
}

async function rebuildBookingDetails(bookingUuid) {
  const { data: bookingData, error } = await supabase
    .from("bookings")
    .select("uuid, user_id, transaction_id, details, entry_code, listing_id, location_id, event_id, status, type")
    .eq("uuid", bookingUuid)
    .maybeSingle();

  if (error || !bookingData) {
    console.error("❌ Booking not found or error:", error);
    return null;
  }

  // Fetch payment method from the transaction
  const { data: transactionData, error: txError } = await supabase
    .from("transactions")
    .select("payment_method")
    .eq("uuid", bookingData.transaction_id)
    .maybeSingle();

  if (txError) {
    console.error("❌ Failed to fetch transaction:", txError);
    return null;
  }

  window.payment_method = transactionData?.payment_method || null;
  window.user_id = bookingData.user_id;
  window.LOCATION_UUID = bookingData.location_id;
  bookingUuid = bookingData.uuid;

  console.log(`✅ PM: ${window.payment_method}, UID: ${window.user_id}`);

  const details = {
    start: bookingData.details?.start || null,
    end: bookingData.details?.end || null,
    status: bookingData.status || null,
    type: bookingData.type || null,
    duration: bookingData.details?.duration || null,
    activities: bookingData.details?.activities || [],
    event_id: bookingData.event_id || [],

    user: {
      first_name: bookingData.details?.user?.first_name || "",
      last_name: bookingData.details?.user?.last_name || "",
      email: bookingData.details?.user?.email || "",
      phone: bookingData.details?.user?.phone || "",
      membership: bookingData.details?.user?.membership || "non-member"
    },

    listing: bookingData.details?.listing || {
      name: "",
      timezone: "America/Chicago"
    },

    transaction: {
      subtotal: bookingData.details?.transaction?.subtotal || 0,
      total: bookingData.details?.transaction?.total || 0,
      tax_rate: bookingData.details?.transaction?.tax_rate || 0,
      tax_total: bookingData.details?.transaction?.tax_total || 0,
      discount_total: bookingData.details?.transaction?.discount_total || 0,
      base_rate: bookingData.details?.transaction?.base_rate || 0,
      final_rate: bookingData.details?.transaction?.final_rate || 0,
      rate_label: bookingData.details?.transaction?.rate_label || "",
      user_credits_applied: bookingData.details?.transaction?.user_credits_applied || 0,
      discounts: bookingData.details?.transaction?.discounts || []
    },

    added_charges: bookingData.details?.added_charges || []
  };

  // Update global details
  window.details = details;

  // Optional: Update booking.details in Supabase (only if needed for Make.com or consistency)
  const { error: updateError } = await supabase
    .from("bookings")
    .update({ details })
    .eq("uuid", bookingUuid);

  if (updateError) {
    console.error("❌ Failed to update booking details:", updateError);
  }

  return details;
}
  
async function refreshBookingData() {
  console.log("🔄 Refreshing booking data...");

  const now = DateTime.now().setZone(TIMEZONE);
  const in30Min = now.plus({ minutes: 30 });
  const in1Hour = now.plus({ hours: 1 });
  const past15Min = now.minus({ minutes: 15 });

  const { data: events, error } = await window.supabase
    .from("events")
    .select("uuid, start, end, location_id, listing_id")
    .eq("location_id", LOCATION_UUID)
    .eq("type", "booking")
    .eq("status", "confirmed")
    .gte("end", past15Min.toISO()) // includes recently ended
    .lte("start", in1Hour.toISO())
    .order("start", { ascending: true });

  if (error) {
    console.error("❌ Failed to fetch events:", error);
    return;
  }

  if (!events.length) {
    console.log("📭 No upcoming or recent events found.");
  }

  const eventUUIDs = events.map(e => e.uuid);

  const { data: bookings, error: bookingError } = await window.supabase
    .from("bookings")
    .select("uuid, event_id, details, user_id, entry_code, prebooking, postbooking")
    .overlaps("event_id", eventUUIDs);

  if (bookingError) {
    console.error("❌ Failed to fetch bookings for events:", bookingError);
    return;
  }

  const enrichedEvents = events.map(event => {
    const booking = bookings.find(b => Array.isArray(b.event_id) && b.event_id.includes(event.uuid));
    return {
      ...event,
      booking,
      bookingDetails: booking?.details || null,
      bookingUuid: booking?.uuid || null
    };
  });

  const nowISO = now.toISO();
  const sidePanel = document.querySelector(".side-col-wrapper");

  // 1. PRE-BOOKING: Trigger if starting within 30min and not yet triggered
  for (const e of enrichedEvents) {
    const start = DateTime.fromISO(e.start);
    const minutesAway = start.diff(now, 'minutes').toObject().minutes;

    if (
      minutesAway <= 30 &&
      minutesAway >= 0 &&
      e.booking &&
      !e.booking.prebooking &&
      e.booking.entry_code
    ) {
      console.log(`🔐 Triggering prebooking for event ${e.uuid}`);
      await triggerPrebooking(e.booking.entry_code, "Light Loft"); // can pass real location
      await triggerMakeWebhook(e.booking.uuid, "pre");
    }
  }

  // 2. POST-BOOKING: Trigger if ended 15min ago and postbooking is still false
  for (const e of enrichedEvents) {
    const end = DateTime.fromISO(e.end);
    const minutesSinceEnd = now.diff(end, "minutes").toObject().minutes;

    if (
      minutesSinceEnd >= 15 &&
      e.booking &&
      !e.booking.postbooking &&
      e.booking.entry_code
    ) {
      const currentEntry = e.booking.entry_code;
      const hasNextBooking = enrichedEvents.find(other => {
        const otherStart = DateTime.fromISO(other.start);
        const minsAway = otherStart.diff(now, "minutes").toObject().minutes;
        return minsAway >= 0 && minsAway <= 60 && other.booking?.entry_code;
      });

      const upcomingCode = hasNextBooking?.booking?.entry_code || null;
      const sameCode = currentEntry === upcomingCode;

      if (sameCode) {
        console.log("🕗 Same code used in next hour — skipping AC off");
        await triggerMakeWebhook(e.booking.uuid, "post");
      } else {
        const acShouldStayOn = !!upcomingCode;
        console.log("🚪 Running post-booking automation:", { acShouldStayOn });
        await triggerPostbooking(currentEntry, acShouldStayOn);
        await triggerMakeWebhook(e.booking.uuid, "post");
      }
    }
  }

  // 3. ACTIVE BOOKING UI
  const activeEvent = enrichedEvents.find(e =>
    DateTime.fromISO(e.start) <= now && DateTime.fromISO(e.end) >= now
  );

  if (activeEvent && activeEvent.bookingDetails) {
    window.currentBooking = activeEvent.bookingDetails;
    bookingUuid = activeEvent.bookingUuid;
    renderCurrentBooking(activeEvent.bookingDetails, activeEvent.bookingUuid, activeEvent);
    await rebuildBookingDetails(bookingUuid);
    sidePanel?.classList.remove("hide");
  } else {
    console.log("🕒 No active booking at the moment");
    sidePanel?.classList.add("hide");
  }
}

function scheduleQuarterHourUpdates(callback) {
    const now = new Date();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    const msUntilNextQuarter = ((15 - (minutes % 15)) % 15) * 60 * 1000 - seconds * 1000;
  
    setTimeout(() => {
        callback(); // initial trigger at next quarter
        setInterval(callback, 15 * 60 * 1000); // every 15 minutes thereafter
    }, msUntilNextQuarter);
}

function showPopupById(id) {
  document.querySelectorAll(".popup-content").forEach(el => el.classList.add("hidden"));
  document.getElementById(id)?.classList.remove("hidden");
  document.getElementById("popup-container")?.classList.remove("hide");
  document.body?.classList.add("no-scroll");
}

function closePopup() {
  document.getElementById("popup-container")?.classList.add("hide");
  document.body?.classList.remove("no-scroll");
}

// TIMER
function startBookingCountdown(startISO, endISO) {
  const start = DateTime.fromISO(startISO, { zone: TIMEZONE });
  const end = DateTime.fromISO(endISO, { zone: TIMEZONE });

  clearInterval(countdownInterval); // avoid duplicates

  countdownInterval = setInterval(() => {
    const now = DateTime.now().setZone(TIMEZONE);
    const total = end.diff(start, 'seconds').seconds;
    const remaining = Math.max(0, end.diff(now, 'seconds').seconds);
    const elapsed = total - remaining;

    // Format as HH:MM:SS
    const hrs = Math.floor(remaining / 3600).toString().padStart(2, "0");
    const mins = Math.floor((remaining % 3600) / 60).toString().padStart(2, "0");
    const secs = Math.floor(remaining % 60).toString().padStart(2, "0");
    const timeStr = `${hrs}:${mins}:${secs}`;

    // Update UI
    const timeEl = document.getElementById("time-remaining");
    const barEl = document.getElementById("timer-progress");

    if (timeEl) timeEl.textContent = timeStr;
    if (barEl && total > 0) {
      const pct = Math.min(100, Math.max(0, (elapsed / total) * 100));
      barEl.style.width = `${pct}%`;
    }

    // Stop if complete
    if (remaining <= 0) {
      clearInterval(countdownInterval);
    }
  }, 1000);
}

// AUTOMATIONS
async function triggerLockCode(entryCode, location) {
  try {
    const res = await fetch(HA_WEBHOOK_PREBOOKING_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        entry_code: entryCode,
        location: location
      })
    });

    if (!res.ok) throw new Error(`Failed: ${res.status}`);
    console.log("✅ Lock code webhook sent:", { entryCode, location });
  } catch (err) {
    console.error("❌ Failed to trigger lock code webhook:", err);
  }
}

async function triggerPrebooking(entryCode, location) {
  try {
    const res = await fetch(HA_WEBHOOK_PREBOOKING_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entry_code: entryCode, location })
    });

    if (!res.ok) throw new Error(`Failed: ${res.status}`);
    console.log("✅ Prebooking webhook sent:", { entryCode, location });
  } catch (err) {
    console.error("❌ Prebooking failed:", err);
  }
}

async function triggerPostbooking(entryCode, hasNextBooking) {
  try {
    const res = await fetch(HA_WEBHOOK_POSTBOOKING_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entry_code: entryCode, has_next: hasNextBooking })
    });

    if (!res.ok) throw new Error(`Failed: ${res.status}`);
    console.log("✅ Postbooking webhook sent:", { entryCode, hasNextBooking });
  } catch (err) {
    console.error("❌ Postbooking failed:", err);
  }
}

async function triggerMakeWebhook(bookingId, type) {
  try {
    const res = await fetch("https://hook.us1.make.com/sy61v7v1u2lhxrq5i4r86as5vbqirfbl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ booking_id: bookingId, type })
    });

    if (!res.ok) throw new Error(`Failed: ${res.status}`);
    console.log(`✅ Make webhook sent for ${type} on ${bookingId}`);
  } catch (err) {
    console.error("❌ Make webhook failed:", err);
  }
}

// ADD TIME
function updateAddTimeUI() {
  const { originalEnd, current } = window.addTimeExtension;

  const added = current.end.diff(originalEnd, 'minutes').minutes;
  document.getElementById("add-time-end-text").textContent =
    `${window.addTimeExtension.originalStart.toFormat("h:mm a")} to ${current.end.toFormat("h:mm a")}`;
  document.getElementById("add-time-end-text").classList.toggle("green", added > 0);
  document.getElementById("confirm-add-time").classList.toggle("disabled", added <= 0);
  document.getElementById("end-less-btn").classList.toggle("disabled", added <= 0);
  document.getElementById("end-more-btn").classList.toggle("disabled", added >= 120); // 2 hour cap
}

// ADD CHARGE
async function setupStripeElements({ containerId, amount, userEmail, buttonSelector }) {

  if (!window.stripe) window.stripe = Stripe("pk_live_51Pc8eHHPk1zi7F68Lfo7LHLTmpxCNsSidfCzjFELM9Ajum07WIMljcsbU9L1R2Tejvue1BaZ0xuDwcpiXjwMgrdq00eUxlyH9D");
  if (!window.elements) window.elements = window.stripe.elements();
  const elements = window.elements;
  const stripe = window.stripe;

  const style = {
    base: {
      color: "#191918",
      fontFamily: "Founders Grotesk, Arial, sans-serif",
      fontWeight: "300",
      letterSpacing: "2px",
      fontSize: "24px",
      "::placeholder": {
        color: "rgba(25, 25, 24, 0.65)"
      }
    },
    invalid: {
      color: "#e53e3e"
    }
  };
  
  const cardNumber = elements.create("cardNumber", { style });
  const cardExpiry = elements.create("cardExpiry", { style });
  const cardCvc = elements.create("cardCvc", { style });

  cardNumber.mount("#card-number-element");
  cardExpiry.mount("#card-expiry-element");
  cardCvc.mount("#card-cvc-element");

  const clientSecret = window.bookingGlobals?.client_secret;
  if (!clientSecret || !amount) return console.warn("Missing clientSecret or amount");

  const paymentRequest = stripe.paymentRequest({
    country: "US",
    currency: "usd",
    total: {
      label: "Total",
      amount: Math.round(amount * 100)
    },
    requestPayerName: true,
    requestPayerEmail: true
  });

  const prButton = elements.create("paymentRequestButton", {
    paymentRequest,
    style: {
      paymentRequestButton: {
        type: "default",
        theme: "dark",
        height: "57.6px",
        borderRadius: "30px"
      }
    }
  });


  paymentRequest.canMakePayment().then((result) => {
    const prContainer = document.getElementById("payment-request-button");
    if (result) {
      prButton.mount("#payment-request-button");
      prContainer.style.display = "block";
    } else {
      prContainer.style.display = "none";
    }
  });

  paymentRequest.on("paymentmethod", async (ev) => {
    try {
      const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
        payment_method: ev.paymentMethod.id
      });
  
      if (error || !paymentIntent) {
        ev.complete("fail");
        alert("Payment failed: " + (error?.message || "Unknown error"));
        return;
      }
  
      ev.complete("success");
  
      // Now trigger your backend webhook
      try {
        const result = await confirmCharge({
          lineItem: window.addChargeDetails.lineItem,
          subtotal: window.addChargeDetails.subtotal,
          taxTotal: window.addChargeDetails.taxTotal,
          total: window.addChargeDetails.total,
          creditsToApply: window.addChargeDetails.creditsToApply,
          paymentMethod: ev.paymentMethod.id,
          savedCard: false
        });
  
        console.log("✅ PR Button charge complete:", result.transaction_uuid);
  
        if (typeof window.bookingGlobals.onSuccess === "function") {
          window.bookingGlobals.onSuccess(result.transaction_uuid);
        }
      } catch (webhookErr) {
        console.error("❌ Webhook failed after PRB payment:", webhookErr);
        alert("Payment succeeded but transaction could not be finalized.");
      }
  
    } catch (err) {
      ev.complete("fail");
      alert("Stripe error: " + err.message);
    }
  });  

  window.stripe = stripe;
  window.cardElements = { cardNumber, cardExpiry, cardCvc };
  window.paymentRequest = paymentRequest;
}

async function createOrUpdateChargeIntent({ lineItem, subtotal, taxTotal, total, creditsToApply = 0 }) {
  const taxRate = window.details.transaction?.tax_rate || 0;
  const payload = {
    subtotal,
    tax_total: taxTotal,
    tax_rate: taxRate,
    total,
    user_credits_applied: creditsToApply,
    user_id: window.user_id,
    booking_id: window.details.uuid,
    line_item: lineItem,
    email: window.details.user?.email,
    payment_intent_id: window.bookingGlobals?.payment_intent_id || null,
    transaction_id: window.bookingGlobals?.transaction_uuid || null
  };

  const url = payload.payment_intent_id
    ? "https://hook.us1.make.com/mh3tg5aoxaa9b3d4qm7dicfu76k9q9k1"
    : "https://hook.us1.make.com/isy5nbt7kyv7op25nsh5gph4k3xy4vbw";

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!res.ok) throw new Error(await res.text());

  const data = await res.json();

  // Store or update bookingGlobals
  window.bookingGlobals.payment_intent_id = data.payment_intent_id;
  window.bookingGlobals.client_secret = data.client_secret || window.bookingGlobals.client_secret;
  window.bookingGlobals.transaction_uuid = data.transaction_uuid || window.bookingGlobals.transaction_uuid;
  window.bookingGlobals.total = data.amount / 100;

  window.addChargeDetails = {
    lineItem,
    subtotal,
    taxTotal,
    total,
    creditsToApply,
    paymentIntentId: data.payment_intent_id,
    transactionId: data.transaction_uuid,
    taxRate
  };

  return data;
}

async function addChargeHandler({ lineItem, subtotal, taxTotal, total, onSuccess }) {
  const chargePopup = document.getElementById("add-charge");
  const actionPopup = document.getElementById("popup");
  const useCreditsBtn = document.querySelector("#use-credits");
  const savedCardBtn = document.querySelector("#add-charge_original-pm");
  const payNowBtn = document.querySelector("#pay-now-btn");
  const summaryLine = document.getElementById("add-charge_line-item");
  const summaryLinePrice = document.getElementById("add-charge_line-item-price");
  const taxRateEl = document.getElementById("add-charge_tax-rate");
  const taxTotalEl = document.getElementById("add-charge_taxes");
  const totalEl = document.getElementById("add-charge_total");
  const savedCardText = savedCardBtn.querySelectorAll(".button-text");

  const creditAmountRaw = window.details.user?.credits || 0;
  let creditsToApply = 0;
  let useCredits = false;

  // Create or update charge
  try {
    const intent = await createOrUpdateChargeIntent({ lineItem, subtotal, taxTotal, total, creditsToApply });

    summaryLine.textContent = lineItem;
    summaryLinePrice.textContent = `$${subtotal.toFixed(2)}`;
    taxRateEl.textContent = `${(window.details.transaction?.tax_rate || 0).toFixed(2)}%`;
    taxTotalEl.textContent = `$${taxTotal.toFixed(2)}`;
    totalEl.textContent = `$${(total - creditsToApply).toFixed(2)}`;
    savedCardText.forEach(t => t.textContent = `Pay $${(total - creditsToApply).toFixed(2)} with Saved Card`);

    await setupStripeElements({
      containerId: "stripe-card-container",
      amount: total,
      userEmail: window.details.user?.email,
      buttonSelector: "#pay-now-btn"
    });
  } catch (err) {
    console.error("❌ Error preparing charge:", err);
    return;
  }

  if (creditAmountRaw === 0) {
    document.getElementById("credits-section")?.classList.add("hidden");
  }

  if (!window.payment_method) {
    document.getElementById("saved-payment-container")?.classList.add("hidden");
  } else {
    document.getElementById("saved-payment-container")?.classList.remove("hidden");
  }  

  // Show popup
  chargePopup.classList.remove("hidden");
  actionPopup.classList.add("background");

  // Toggle credits
  useCreditsBtn.onclick = async () => {
    useCredits = !useCredits;
    useCreditsBtn.classList.toggle("active");

    creditsToApply = useCredits && creditAmountRaw > 0.5 ? Math.min(creditAmountRaw, total) : 0;
    window.addChargeDetails.creditsToApply = creditsToApply;
    useCreditsBtn.textContent = useCredits
      ? `$${creditsToApply.toFixed(2)} in credits applied`
      : "Use your credits for this transaction";

    totalEl.textContent = `$${(total - creditsToApply).toFixed(2)}`;
    savedCardText.forEach(t => t.textContent = `Pay $${(total - creditsToApply).toFixed(2)} with Saved Card`);

    try {
      const updatedTotal = total - creditsToApply;
      const updatedTaxTotal = roundDecimals(updatedTotal * (window.details.transaction?.tax_rate || 0) / (1 + (window.details.transaction?.tax_rate || 0) / 100));
      const updatedSubtotal = roundDecimals(updatedTotal - updatedTaxTotal);

      window.addChargeDetails = {
        lineItem,
        subtotal: updatedSubtotal,
        taxTotal: updatedTaxTotal,
        total: updatedTotal,
        creditsToApply
      };

      await createOrUpdateChargeIntent({
        lineItem,
        subtotal: updatedSubtotal,
        taxTotal: updatedTaxTotal,
        total: updatedTotal,
        creditsToApply
      });

    } catch (err) {
      console.warn("⚠️ Failed to update payment intent with credits:", err);
    }
  };

  // Pay with saved card
  savedCardBtn.onclick = async (e) => {
    e.preventDefault();
    savedCardBtn.classList.add("processing");
    savedCardBtn.querySelectorAll(".button-text").forEach(t => t.textContent = "Processing...");

    try {
      const result = await confirmCharge({
        lineItem: window.addChargeDetails.lineItem,
        subtotal: window.addChargeDetails.subtotal,
        taxTotal: window.addChargeDetails.taxTotal,
        total: window.addChargeDetails.total,
        creditsToApply: window.addChargeDetails.creditsToApply,
        paymentMethod: window.payment_method,
        savedCard: true
      });

      console.log("✅ Charge complete:", result.transaction_uuid);
      chargePopup.classList.add("hidden");
      actionPopup.classList.remove("background");

      if (onSuccess) onSuccess(result.transaction_uuid);

      setTimeout(() => {
        delete window.bookingGlobals.payment_intent_id;
        delete window.bookingGlobals.transaction_uuid;
      }, 3000); 
    } catch (err) {
      savedCardBtn.classList.remove("processing");
      savedCardText.forEach(t => t.textContent = `Pay $${total.toFixed(2)} with Saved Card`);
      console.error("❌ Error during saved card charge:", err);
      alert("Payment failed. Try again with a new payment method.");
      document.getElementById("saved-payment-container")?.classList.add("hidden");
    }
  };

  // Pay with new card
  payNowBtn.onclick = async () => {
    if (payNowBtn.classList.contains("disabled")) return;

    payNowBtn.classList.add("disabled");
    payNowBtn.querySelectorAll(".button-text").forEach(t => t.textContent = "Processing...");

    const finalCredits = useCredits ? creditsToApply : 0;
    const finalTotal = parseFloat((total - creditsToApply).toFixed(2));
    const clientSecret = window.bookingGlobals?.client_secret;

    try {
      const { paymentMethod, error } = await window.stripe.createPaymentMethod({
        type: "card",
        card: window.cardElements.cardNumber,
        billing_details: {
          email: window.details.user?.email || ""
        }
      });

      if (error) throw error;

      const result = await window.stripe.confirmCardPayment(clientSecret, {
        payment_method: paymentMethod.id,
        setup_future_usage: "off_session"
      });

      if (result.error) throw result.error;

      const confirmResult = await confirmCharge({
        lineItem: window.addChargeDetails.lineItem,
        subtotal: window.addChargeDetails.subtotal,
        taxTotal: window.addChargeDetails.taxTotal,
        total: window.addChargeDetails.total,
        creditsToApply: window.addChargeDetails.creditsToApply,
        paymentMethod: paymentMethod.id,
        savedCard: false
      });

      console.log("✅ New card charge complete:", confirmResult.transaction_uuid);
      chargePopup.classList.add("hidden");
      actionPopup.classList.remove("background");

      if (onSuccess) onSuccess(confirmResult.transaction_uuid);

      setTimeout(() => {
        delete window.bookingGlobals.payment_intent_id;
        delete window.bookingGlobals.transaction_uuid;
      }, 3000); 

    } catch (err) {
      console.error("❌ Error with new card payment:", err);
      alert("Payment failed. Try again.");
    } finally {
      payNowBtn.classList.remove("processing");
      payNowBtn.querySelectorAll(".button-text").forEach(t => t.textContent = "Pay with Card");
    }
  };
}

async function confirmCharge({
  lineItem,
  subtotal,
  taxTotal,
  total,
  creditsToApply,
  paymentMethod,
  savedCard
}) {
  const payload = {
    line_item: lineItem,
    subtotal,
    tax_rate: window.details.transaction?.tax_rate || 0,
    tax_total: taxTotal,
    total,
    booking_id: bookingUuid,
    user_id: window.user_id,
    payment_method: paymentMethod,
    saved_card: savedCard,
    user_credits_applied: creditsToApply,
    payment_intent_id: window.bookingGlobals.payment_intent_id,
    transaction_id: window.bookingGlobals.transaction_uuid
  };

  const res = await fetch("https://hook.us1.make.com/b7m5qiaw6udii3xpalks2jxjljms6elj", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!res.ok) throw new Error(await res.text());

  const data = await res.json();
  window.transaction_id = data.transaction_uuid;

  return data;
}
