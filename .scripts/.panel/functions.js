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
