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
  
    document.getElementById("guest-name").textContent = `${user.first_name || ""} ${user.last_name || ""}`;
    document.getElementById("booking-time-range").textContent = `${start.toFormat("h:mm a")} – ${end.toFormat("h:mm a")}`;
    document.getElementById("listing-name").textContent = listing.name || "—";
    document.getElementById("entry-code").textContent = bookingDetails.entry_code || "—";
    document.getElementById("transaction-id").textContent = bookingDetails.transaction_id || "—";
    document.getElementById("checkout-status").textContent = bookingDetails.checkout_completed ? "✅ Completed" : "❌ Not Completed";
}
  
  