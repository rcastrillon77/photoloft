// =======================
// CONSTANTS
// =======================

const { DateTime } = luxon;

const LOCATION_UUID = "9e92e73f-4f4a-4252-8d56-ebd8e74772f1";
const TIMEZONE = "America/Chicago";


let countdownInterval = null;

// AUTOMATIONS

const HA_WEBHOOK_PREBOOKING_URL = "https://g1tsatjpileqd6zlkmhhrnlhbit9isyo.ui.nabu.casa/api/webhook/pre_booking_setup";
const HA_WEBHOOK_POSTBOOKING_URL = "https://g1tsatjpileqd6zlkmhhrnlhbit9isyo.ui.nabu.casa/api/webhook/post_booking_cleanup";
const HA_WEBHOOK_SNAPSHOT_URL = "https://g1tsatjpileqd6zlkmhhrnlhbit9isyo.ui.nabu.casa/api/webhook/snapshot_trigger"; 

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

function renderCurrentBooking(bookingDetails, bookingUUID, event) {
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
      bookingUUID: booking?.uuid || null
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
    renderCurrentBooking(activeEvent.bookingDetails, activeEvent.bookingUUID, activeEvent);
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


// =======================
// INIT
// =======================

document.addEventListener("DOMContentLoaded", async () => {
    console.log("🟢 Studio control panel script loaded");
    await refreshBookingData();
    scheduleQuarterHourUpdates(refreshBookingData);

    if (window.currentBookingUUID) {
      await rebuildBookingDetails(window.currentBookingUUID);
      await initBookingConfig(LISTING_UUID);
      populateReservationDetails(window.details);
      applyActionButtonStates(window.details);
    }

});
  
document.getElementById("test-trigger")?.addEventListener("click", async () => {
    await triggerLockCode("0752", "Light Loft");
});
  
// AMENITIES ACCORDION
document.addEventListener("DOMContentLoaded", () => {
    // Remove .open from all amenities on page load
    document.querySelectorAll(".amenity").forEach(el => {
      el.classList.remove("open");
      const icon = el.querySelector(".cross-icon");
      if (icon) icon.classList.remove("open");
    });
  
    // Add click listener to each .amenity_title
    document.querySelectorAll(".amenity_title").forEach(title => {
      title.addEventListener("click", () => {
        const amenity = title.closest(".amenity");
        const isOpen = amenity.classList.contains("open");
  
        // Remove .open from all amenities and icons
        document.querySelectorAll(".amenity").forEach(el => {
          el.classList.remove("open");
          const icon = el.querySelector(".cross-icon");
          if (icon) icon.classList.remove("open");
        });
  
        // If it was not already open, open it
        if (!isOpen) {
          amenity.classList.add("open");
          const icon = title.querySelector(".cross-icon");
          if (icon) icon.classList.add("open");
        }
      });
    });
});

// ADD TIME
document.getElementById("actions_add-time")?.addEventListener("click", async () => {
  const details = window.currentBooking;
  if (!details) return alert("No booking loaded.");

  const originalEnd = luxon.DateTime.fromISO(details.end, { zone: TIMEZONE });
  const interval = 30; // or fetch from listing config

  addTimeExtension = {
    originalStart: luxon.DateTime.fromISO(details.start, { zone: TIMEZONE }),
    originalEnd,
    current: { end: originalEnd },
    interval
  };

  document.getElementById("add-time-limit").textContent = `Add up to 2 hours after`; // Or calculate
  updateAddTimeUI();

  showPopupById("add-time-popup");
});

document.getElementById("end-more-btn")?.addEventListener("click", () => {
  const { current, originalEnd, interval } = addTimeExtension;
  const newEnd = current.end.plus({ minutes: interval });
  if (newEnd <= originalEnd.plus({ minutes: 120 })) {
    current.end = newEnd;
    updateAddTimeUI();
  }
});

document.getElementById("end-less-btn")?.addEventListener("click", () => {
  const { current, originalEnd, interval } = addTimeExtension;
  const newEnd = current.end.minus({ minutes: interval });
  if (newEnd >= originalEnd) {
    current.end = newEnd;
    updateAddTimeUI();
  }
});

document.getElementById("confirm-add-time")?.addEventListener("click", async () => {
  const details = window.currentBooking;
  const { originalEnd, current } = addTimeExtension;
  const addedMinutes = current.end.diff(originalEnd, "minutes").minutes;

  if (addedMinutes <= 0) return;

  const subtotal = (details.transaction.final_rate / 60) * addedMinutes;
  const taxRate = details.transaction.tax_rate || 0.0825;
  const taxTotal = subtotal * taxRate;
  const total = subtotal + taxTotal;

  const lineItem = `Added ${Math.round(addedMinutes)} Minutes`;

  await addChargeHandler({
    lineItem,
    subtotal,
    taxTotal,
    total,
    onSuccess: async () => {
      const payload = {
        booking_id: details.uuid,
        start: details.start,
        end: current.end.toISO(),
        duration: current.end.diff(luxon.DateTime.fromISO(details.start), "minutes").minutes,
        listing_name: details.listing?.name || "",
        added_minutes: addedMinutes
      };

      await fetch("https://hook.us1.make.com/zse7u92reikd8k266hhalkgvjawp9jk2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      showPopupById("confirmation-popup");
      document.getElementById("confirm-popup-header").textContent = "Time Added";
      document.getElementById("confirm-popup-paragraph").textContent = "Your booking has been extended.";
    }
  });
});

// CHECKOUT PROCESS
window.initCheckoutScrollFlow = async function () {
  console.log("🚀 Initializing dynamic scroll-based checkout...");

  const allSteps = await loadCheckoutProcess(LISTING_UUID);
  let successStep = null;
  const steps = [];

  for (const step of allSteps) {
    if (step.type === "success") {
      successStep = step;
    } else {
      steps.push(step);
    }
  }

  const container = document.getElementById("checkout-process");
  container.innerHTML = ""; // clear existing content

  if (!steps?.length) {
    container.innerHTML = "<p>No checkout steps found.</p>";
    return;
  }

  const responses = {};
  const elements = {}; // keep refs for data gathering

  steps.forEach((step, index) => {
    const stepId = `${step.title?.toLowerCase().replace(/\s+/g, "-")}-${step.type}`;

    const wrapper = document.createElement("div");
    wrapper.classList.add("section-container");

    const headerBlock = document.createElement("div");
    headerBlock.classList.add("div-block-249");

    const stepNumber = document.createElement("div");
    stepNumber.classList.add("text-block-108");
    stepNumber.textContent = `${index + 1}`;

    const header = document.createElement("div");
    header.classList.add("section-header");
    header.textContent = step.title || "";

    headerBlock.append(stepNumber, header);

    const content = document.createElement("div");
    content.classList.add("checkout-step-content");

    const description = document.createElement("div");
    description.classList.add("checkout-description");
    description.textContent = step.description || "";

    content.appendChild(description);

    // === Step Type Handling ===
    if (step.type === "gallery") {
      const gallery = document.createElement("div");
      gallery.classList.add("checkout-gallery");
      let imgIndex = 0;

      gallery.style.backgroundImage = `url(${step.gallery[imgIndex]})`;

      const prev = document.createElement("a");
      prev.href = "#";
      prev.textContent = "←";
      prev.onclick = e => {
        e.preventDefault();
        imgIndex = (imgIndex - 1 + step.gallery.length) % step.gallery.length;
        gallery.style.backgroundImage = `url(${step.gallery[imgIndex]})`;
      };

      const next = document.createElement("a");
      next.href = "#";
      next.textContent = "→";
      next.onclick = e => {
        e.preventDefault();
        imgIndex = (imgIndex + 1) % step.gallery.length;
        gallery.style.backgroundImage = `url(${step.gallery[imgIndex]})`;
      };

      gallery.append(prev, next);
      content.appendChild(gallery);
    }

    if (step.type === "checkbox" || step.type === "show-field") {
      const fieldContainer = document.createElement("div");
      fieldContainer.classList.add("section-container", "form-fields");

      const label = document.createElement("label");
      label.classList.add("checkbox-field", "light");

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.classList.add("checkbox");
      checkbox.name = stepId;
      checkbox.id = stepId;
      checkbox.checked = step["show-field"]?.["checkbox-default"] || step["default"] || false;

      const checkmark = document.createElement("div");
      checkmark.classList.add("checkmark");

      const checkboxTextSection = document.createElement("div");
      checkboxTextSection.classList.add("checkbox-text-section");

      const checkboxText = document.createElement("p");
      checkboxText.classList.add("checkbox-text");
      checkboxText.textContent = step["show-field"]?.["checkbox-label"] || step["checkbox-label"] || "Checkbox";

      checkboxTextSection.appendChild(checkboxText);
      label.append(checkbox, checkmark, checkboxTextSection);
      fieldContainer.appendChild(label);

      const updateCheckboxVisual = () => {
        label.classList.toggle("checked", checkbox.checked);
        checkmark.classList.toggle("checked", checkbox.checked);
      };

      checkbox.addEventListener("change", updateCheckboxVisual);
      updateCheckboxVisual();

      // Textarea for show-field
      let textarea;
      if (step.type === "show-field") {
        const inputWrapper = document.createElement("div");
        inputWrapper.classList.add("form-input");

        const inputLabel = document.createElement("div");
        inputLabel.classList.add("field-label");
        inputLabel.textContent = step["show-field"]["field-label"] || "Message";

        textarea = document.createElement("textarea");
        textarea.classList.add("input-field", "textarea");
        textarea.name = `${stepId}-textarea`;
        textarea.id = `${stepId}-textarea`;

        inputWrapper.append(inputLabel, textarea);
        fieldContainer.appendChild(inputWrapper);

        checkbox.checked = step["show-field"]?.["checkbox-default"] || false;

        const toggleTextarea = () => {
          const shouldHide = checkbox.checked === step["show-field"]["show-field-if"];
          inputWrapper.classList.toggle("hidden", shouldHide);
        };        

        checkbox.addEventListener("change", toggleTextarea);
        toggleTextarea();
      }

      content.appendChild(fieldContainer);
      elements[stepId] = { checkbox, textarea };
    }

    wrapper.append(headerBlock, content);
    container.appendChild(wrapper);
  });

  // === Submit Button ===
  const submitBtn = document.createElement("a");
  submitBtn.href = "#";
  submitBtn.id = "checkout-submit";
  submitBtn.classList.add("button", "w-inline-block");

  submitBtn.innerHTML = `
    <div class="button-text-wrapper">
      <div class="button-text-container">
        <div class="button-text">Complete Checkout Process</div>
        <div class="button-text-with-icon">
          <div class="button-text">Complete Checkout Process</div>
          <div class="button-icon">→</div>
        </div>
      </div>
    </div>
  `;

  submitBtn.addEventListener("click", async (e) => {
    e.preventDefault();

    const payload = {
      booking_id: bookingUuid,
      responses: {}
    };

    Object.entries(elements).forEach(([key, el]) => {
      if (el.checkbox && el.textarea) {
        const show = el.checkbox.checked !== steps.find(s =>
          key.startsWith(s.title?.toLowerCase().replace(/\s+/g, "-"))
        )["show-field"]["show-field-if"];
    
        const value = el.textarea.value.trim();
        if (show && value !== "") {
          payload.responses[key] = {
            checked: el.checkbox.checked,
            value
          };
        } else if (el.checkbox.checked) {
          payload.responses[key] = {
            checked: true,
            value: null
          };
        }
        // Else skip entirely
      } else if (el.checkbox) {
        payload.responses[key] = el.checkbox.checked;
      }
    });    

    console.log("📤 Submitting dynamic checkout:", payload);

    try {
      await fetch("https://hook.us1.make.com/lila320113a7nngn29ix7yl94snyqjjr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      console.log("✅ Submission complete");
      if (successStep) {
        details = await rebuildBookingDetails(bookingUuid);
        populateReservationDetails(details);
        applyActionButtonStates(details);
        
        document.getElementById("confirm-popup-header").textContent = successStep.title || "Thank You";
        document.getElementById("confirm-popup-paragraph").textContent = successStep.description || "Your checkout is complete.";
        showPopupById("confirmation-popup");
      }
    } catch (err) {
      console.error("❌ Submission failed:", err);
      alert("Checkout submission failed. Please try again.");
    }
  });

  container.appendChild(submitBtn);
};

document.getElementById("actions_checkout")?.addEventListener("click", async () => {
  await initCheckoutScrollFlow();
  showPopupById("checkout-process");
});

