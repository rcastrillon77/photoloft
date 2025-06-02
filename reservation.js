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

const CANCELLATION_WEBHOOK_URL = "https://hook.us1.make.com/umtemq9v49b8jotoq8elw61zntvak8q4";

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

function openPopup() {
  document.getElementById("popup-container").classList.remove("hide");
  document.body.classList.add("no-scroll");
}

function closePopup() {
  document.getElementById("popup-container").classList.add("hide");
  document.body.classList.remove("no-scroll");
  document.querySelectorAll(".popup-content").forEach(el => el.classList.add("hidden"));
}

function showPopupById(id) {
  document.querySelectorAll(".popup-content").forEach(el => el.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
  openPopup();
}

function getRefundAmounts(startTimeISO, totalPaid, creditsUsed = 0) {
  const now = luxon.DateTime.now().setZone(bookingDetails.listing.timezone);
  const startTime = luxon.DateTime.fromISO(startTimeISO).setZone(bookingDetails.listing.timezone);
  const hoursDiff = startTime.diff(now, "hours").hours;

  let cash = 0;
  let credit = 0;

  if (hoursDiff >= 240) {
    cash = totalPaid;
    credit = 0;
  } else if (hoursDiff >= 120) {
    cash = totalPaid * 0.5;
    credit = totalPaid * 0.6;
  } else if (hoursDiff >= 48) {
    cash = totalPaid * 0.25;
    credit = totalPaid * 0.35;
  } else {
    cash = 0;
    credit = totalPaid * 0.10;
  }

  return {
    hoursDiff,
    cash: Math.round(cash * 100) / 100,
    credit: Math.round(credit * 100) / 100,
    user_credits_returned: creditsUsed,
  };
}

async function sendCancellationWebhook({ booking_uuid, listing_name, credit_refund, cash_refund, user_credits_returned }) {
  const payload = {
    booking_uuid,
    listing_name,
    credit_refund,
    cash_refund,
    user_credits_returned
  };

  try {
    const res = await fetch(CANCELLATION_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const json = await res.json();
    return json;
  } catch (error) {
    console.error("❌ Error sending webhook:", error);
    throw error;
  }
}

async function handleCancelBooking(isCredit = true) {
  const transaction = bookingDetails.transaction;
  const refund = getRefundAmounts(bookingDetails.start, transaction.total, transaction.user_credits_applied);
  const amount = isCredit ? refund.credit : refund.cash;

  try {
    await sendCancellationWebhook({
      booking_uuid: bookingDetails.uuid,
      listing_name: bookingDetails.listing.name,
      credit_refund: isCredit ? amount : 0,
      cash_refund: isCredit ? 0 : amount,
      user_credits_returned: refund.user_credits_returned
    });

    reloadBookingDetails();

    const message = amount === 0
      ? "You are not eligible for a refund, but you’ve received 10% back in credit for future use."
      : isCredit
        ? `You will receive a $${amount.toFixed(2)} credit back to your Photoloft account, available to use immediately.`
        : `You will receive a $${amount.toFixed(2)} refund to your original payment method. Refunds can take 5–10 business days to process.`;

    document.getElementById("confirm-popup").querySelector(".popup-header").textContent = "Reservation Cancelled";
    document.getElementById("confirm-popup").querySelector(".popup-text").textContent = `Your booking has been cancelled. ${message}`;
    showPopupById("confirm-popup");

  } catch (err) {
    alert("There was a problem cancelling your booking. Please try again.");
  }
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
  const refund = getRefundAmounts(details.start, details.transaction.total, details.transaction.user_credits_applied);
  const durationStr = refund.hoursDiff >= 24
    ? `${Math.floor(refund.hoursDiff / 24)} days away`
    : `${Math.floor(refund.hoursDiff)} hours away`;

  document.getElementById("cancel-paragraph").innerHTML =
    `Your reservation is ${durationStr}. Per the cancellation policy, you are eligible for a <strong>${refund.cash > 0 ? (refund.cash / details.transaction.total) * 100 : 0}%</strong> refund or a <strong>${refund.credit > 0 ? (refund.credit / details.transaction.total) * 100 : 0}%</strong> credit.`;

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
