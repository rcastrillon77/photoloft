const urlParams = new URLSearchParams(window.location.search);
const bookingUuid = urlParams.get("booking");

if (!bookingUuid) {
  console.warn("⚠️ No booking ID in URL.");
}

window.bookingGlobals = {
  booking_uuid: null,
  listing_uuid: null,
  transaction_uuid: null,
  event_uuid: [],
  user_uuid: null,
  
  start: null,
  end: null,
  duration: null,
  date: null,
  timezone: null,
  status: null,
  cameras: true,
  attendees: null,
  activities: [],

  transaction: {
    base_rate: null,
    final_rate: null,
    rate_label: null,
    discounts: [],
    credits_applied: null,
    subtotal: null,
    tax_rate: null,
    tax_subtotal: null,
    total: null
  },

  user: {
    first_name: null,
    last_name: null,
    email: null,
    phone: null,
    membership: null
  },

  listing: {
    name: null,
    address: {
      address_line_1: null,
      address_line_2: null,
      city: null,
      state: null,
      zip_code: null
    }
  }
};


async function rebuildBookingDetails(bookingUuid) {
  const { data: bookingData, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("uuid", bookingUuid)
    .maybeSingle();

  if (error || !bookingData) {
    console.error("❌ Booking not found or error:", error);
    return null;
  }

  const [user, transaction, events, locations] = await Promise.all([
    supabase.from("users").select("*").eq("uuid", bookingData.user_id).maybeSingle(),
    supabase.from("transactions").select("*").eq("uuid", bookingData.transaction_id).maybeSingle(),
    supabase.from("events").select("*").in("uuid", bookingData.event_id).then(res => res.data || []),
    supabase.from("locations").select("*").in("uuid", bookingData.location_id).then(res => res.data || [])
  ]);

  const firstEvent = events[0] || {};
  const firstLocation = locations[0] || {};

  const { DateTime } = luxon;
  const timezone = details?.listing?.timezone || 'America/Chicago'; // fallback


  const details = {
    start: firstEvent.start || null,
    end: firstEvent.end || null,
    duration: firstEvent.duration || null,
    attendees: bookingData.details?.attendees || null,
    user: {
      first_name: user.data?.first_name || "",
      last_name: user.data?.last_name || "",
      email: user.data?.email || "",
      phone: user.data?.phone || "",
      membership: user.data?.membership || "guest"
    },
    listing: bookingData.details?.listing || {
      name: firstLocation.name || "",
      address_line_1: firstLocation.address?.address_line_1 || "",
      address_line_2: firstLocation.address?.address_line_2 || "",
      city: firstLocation.address?.city || "",
      state: firstLocation.address?.state || "",
      zip_code: firstLocation.address?.zip_code || "",
      timezone: firstEvent.timezone || "America/Chicago",
      coordinates: firstLocation.coordinates || {}
    },
    activities: bookingData.details?.activities || [],
    transaction: {
      subtotal: transaction.data?.subtotal || 0,
      total: transaction.data?.total || 0,
      tax_rate: transaction.data?.tax_rate || 0,
      tax_total: transaction.data?.taxes_total || 0,
      discount_total: transaction.data?.discount_total || 0,
      base_rate: transaction.data?.base_rate || 0,
      final_rate: transaction.data?.final_rate || 0,
      rate_label: transaction.data?.rate_label || "",
      user_credits_applied: transaction.data?.user_credits_applied || 0,
      discounts: transaction.data?.discounts || []
    }
  };

  const { error: updateError } = await supabase
    .from("bookings")
    .update({ details })
    .eq("uuid", bookingUuid);

  if (updateError) {
    console.error("❌ Failed to update booking details:", updateError);
    return null;
  }

  console.log("✅ Booking details updated.");
  return details;
}

function populateReservationDetails(details) {
  if (!details) return;

  const start = DateTime.fromISO(details.start).setZone(timezone);
  const end = DateTime.fromISO(details.end).setZone(timezone);

  document.getElementById("details_user").textContent =
    `${details.user?.first_name || ''} ${details.user?.last_name || ''}`;

  document.getElementById("details_listing").textContent =
    details.listing?.name || "";

  document.getElementById("details_address").innerHTML = `
    ${details.listing?.address_line_1 || ''} ${details.listing?.address_line_2 || ''}<br>
    ${details.listing?.city || ''}, ${details.listing?.state || ''} ${details.listing?.zip_code || ''}
  `;

  document.getElementById("details_date").textContent =
    DateTime.fromISO(start).setZone(timezone).toFormat('cccc, LLLL d, yyyy');

  document.getElementById("details_start").textContent = start.toFormat("h:mm a");
  document.getElementById("details_end").textContent = end.toFormat("h:mm a z");

  document.getElementById("details_duration").textContent =
    `${details.duration/60 || '?'} Hours`;

  document.getElementById("details_attendees").textContent =
    `${details.attendees || '?'} People`;

  document.getElementById("details_paid").textContent =
    `$${(details.transaction?.total || 0).toFixed(2)}`;
}

function calculateRefundPercent(startTimeISO) {
  const now = luxon.DateTime.now();
  const start = luxon.DateTime.fromISO(startTimeISO);
  const diff = start.diff(now, "days").days;

  if (diff > 10) return 1;       // 100%
  if (diff > 5) return 0.5;      // 50%
  if (diff > 2) return 0.25;     // 25%
  return 0;                      // same-day or < 2 days
}

function getTimeUntil(startISO) {
  const now = luxon.DateTime.now();
  const start = luxon.DateTime.fromISO(startISO);
  const diff = start.diff(now, ['days', 'hours']).toObject();

  if (diff.days >= 1) return `${Math.floor(diff.days)} day${diff.days >= 2 ? 's' : ''} away`;
  if (diff.hours >= 1) return `${Math.floor(diff.hours)} hour${diff.hours >= 2 ? 's' : ''} away`;
  return `less than 1 hour away`;
}

function showCancellationPopup({ booking, refundPercent, creditAmount, cashAmount }) {
  const durationText = getTimeUntil(booking.details.start);
  const percentText = refundPercent * 100;

  document.getElementById("cancel-paragraph").innerHTML =
    `Your reservation is ${durationText}. Per the cancellation policy, you are eligible for a ${percentText}% refund.`;

  document.querySelectorAll("#confirm-credit-cancel .button-text").forEach(el => {
    el.textContent = `Confirm $${creditAmount.toFixed(2)} Credit Refund`;
  });

  document.getElementById("confirm-cash-cancel").textContent =
    `or get $${cashAmount.toFixed(2)} back to your payment method`;

  document.getElementById("cancellations").classList.add("visible");
}

async function sendCancellationWebhook({ booking, refundPercent, useCredit }) {
  const totalPaid = booking.transaction?.total || 0;
  const baseRefund = totalPaid * refundPercent;
  const bonusCredit = useCredit ? baseRefund * 1.1 : 0;

  const payload = {
    booking_uuid: booking.uuid,
    listing_name: booking.details?.listing?.name || "Unknown Listing",
    credit_refund: useCredit ? +bonusCredit.toFixed(2) : 0,
    cash_refund: useCredit ? 0 : +baseRefund.toFixed(2)
  };

  const response = await fetch("https://hook.us1.make.com/umtemq9v49b8jotoq8elw61zntvak8q4", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    alert("Something went wrong cancelling your booking.");
    console.error("Webhook error:", await response.text());
    return false;
  }

  return true;
}



async function initReservationUpdate() {
  if (!bookingUuid) return;

  const details = await rebuildBookingDetails(bookingUuid);
  if (!details) {
    alert("Unable to load booking.");
    return;
  }

  populateReservationDetails(details);
  console.log("✅ Reservation populated.");
}

initReservationUpdate();

document.getElementById("actions_cancel").addEventListener("click", () => {
  const refund = getRefundAmounts(bookingDetails.start, bookingDetails.transaction.total, bookingDetails.transaction.user_credits_applied);
  const durationStr = refund.hoursDiff >= 24
    ? `${Math.floor(refund.hoursDiff / 24)} days away`
    : `${Math.floor(refund.hoursDiff)} hours away`;

  document.getElementById("cancel-paragraph").innerHTML =
    `Your reservation is ${durationStr}. Per the cancellation policy, you are eligible for a <strong>${refund.cash > 0 ? (refund.cash / bookingDetails.transaction.total) * 100 : 0}%</strong> refund or a <strong>${refund.credit > 0 ? (refund.credit / bookingDetails.transaction.total) * 100 : 0}%</strong> credit.`;

  const creditBtn = document.getElementById("confirm-credit-cancel");
  const cashBtn = document.getElementById("confirm-cash-cancel");
  creditBtn.querySelector(".button-text").textContent = `Confirm $${refund.credit.toFixed(2)} Credit Refund`;
  cashBtn.textContent = `or get $${refund.cash.toFixed(2)} back to your payment method`;

  creditBtn.onclick = () => handleCancelBooking(true);
  cashBtn.onclick = () => handleCancelBooking(false);

  showPopupById("cancel-popup");
});

document.getElementById("actions_reschedule").addEventListener("click", () => {
  showPopupById("reschedule-popup");
});

document.getElementById("popup-closer").addEventListener("click", closePopup);
document.getElementById("popup-close-btn").addEventListener("click", closePopup);
