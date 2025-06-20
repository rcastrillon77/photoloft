// =======================
// CONSTANTS
// =======================

const { DateTime } = luxon;

const LOCATION_UUID = "9e92e73f-4f4a-4252-8d56-ebd8e74772f1";
const TIMEZONE = "America/Chicago";


let countdownInterval = null;

// AUTOMATIONS

const HA_WEBHOOK_PREBOOKING_URL = "https://g1tsatjpileqd6zlkmhhrnlhbit9isyo.ui.nabu.casa/api/webhook/pre_booking_setup";
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
  
    const events = await fetchUpcomingEvents();
    const eventUUIDs = events.map(e => e.uuid);
    const bookings = await fetchBookingsForEvents(eventUUIDs);
  
    const enrichedEvents = events.map(event => {
        const booking = bookings.find(b => Array.isArray(b.event_id) && b.event_id.includes(event.uuid));
        return {
            ...event,
            bookingDetails: booking?.details || null,
            bookingUUID: booking?.uuid || null
        };
    });
  
    const sidePanel = document.querySelector(".side-col-wrapper");
  
    const now = DateTime.now().setZone(TIMEZONE);

    enrichedEvents.forEach(e => {
        const start = DateTime.fromISO(e.start);
        const minutesAway = start.diff(now, 'minutes').toObject().minutes;

        if (minutesAway <= 30 && minutesAway > 29 && !e.triggered) {
            const booking = e.bookingDetails;

            captureAndUploadSnapshots(booking)
            .then(() => triggerHomeSetup(booking))
            .then(() => {
                if (booking.cameras === false) {
                  return resetCameraPositions(["light-loft-back-room", "light-loft-east", "light-loft-west"]);
                }
              })
            .catch(console.error);

            e.triggered = true; // avoid repeat on next refresh
        }
    });

    const activeEvent = enrichedEvents.find(e => {
        return DateTime.fromISO(e.start) <= now && DateTime.fromISO(e.end) >= now;
      });

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
  
async function triggerHomeSetup(booking) {
    try {
      await fetch(HA_WEBHOOK_PREBOOKING_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entry_code: booking.entry_code,
          location: booking.listing?.name || "unknown"
        })
      });
  
      console.log("🏠 Home Assistant setup triggered");
    } catch (err) {
      console.error("❌ Home setup failed:", err);
    }
}

// =======================
// INIT
// =======================

document.addEventListener("DOMContentLoaded", async () => {
    console.log("🟢 Studio control panel script loaded");
    await refreshBookingData();
    scheduleQuarterHourUpdates(refreshBookingData);
});
  
document.getElementById("test-trigger")?.addEventListener("click", async () => {
    console.log("🧪 Triggering test pre-booking flow...");
  
    const dummyBooking = {
      uuid: "test-booking-uuid",
      start: DateTime.now().toISO(),
      end: DateTime.now().plus({ hours: 1 }).toISO(),
      entry_code: "0752",
      listing: {
        name: "Light Loft"
      },
      user: {
        first_name: "Test",
        last_name: "User"
      }
    };
  
    try {
      await triggerHomeSetup(dummyBooking);
      console.log("✅ Test pre-booking flow complete");
    } catch (err) {
      console.error("❌ Test flow failed:", err);
    }
  });
  