"""
TicketLedger - Synthetic & Hugging Face Dataset Generator for Pakistani Event Ticketing
Generates:
1. behavior_sequences.csv (100,000 rows)
2. fraud_purchases.csv (50,000 rows)
3. event_demand.csv (5,000 rows)
4. attendance_no_show.csv (50,000 rows)
"""

import os
import json
import time
import requests
import numpy as np
import pandas as pd

# Paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
os.makedirs(DATA_DIR, exist_ok=True)

# Pakistani Ticketing Domain Constants
CITIES = ["Lahore", "Karachi", "Islamabad", "Rawalpindi", "Multan", "Peshawar", "Faisalabad", "Quetta"]
CITY_WEIGHTS = [0.30, 0.30, 0.15, 0.10, 0.05, 0.04, 0.04, 0.02]

EVENT_TYPES = [
    "CRICKET_MATCH",    # PSL, Bilateral, Domestic
    "FOOTBALL_MATCH",   # Challenge Cup, Premier League
    "KABADDI",          # Circle Style Kabaddi championship
    "BOXING",           # Amir Khan Academy / National Box
    "MUSIC_CONCERT",    # Atif Aslam, Ali Zafar, Kaavish
    "MUSIC_FESTIVAL"    # Solis, Lahore Music Meet
]
EVENT_WEIGHTS = [0.45, 0.08, 0.12, 0.05, 0.20, 0.10]

DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
DAY_WEIGHTS = [0.08, 0.08, 0.09, 0.10, 0.18, 0.25, 0.22]

TIERS = ["General Enclosure", "First Class", "Premium", "VIP Enclosure", "VVIP Box"]
TIER_WEIGHTS = [0.50, 0.25, 0.13, 0.09, 0.03]

WEATHER_CONDITIONS = ["Clear", "Pleasant", "Humid", "Foggy", "Rainy", "Extreme Heat"]
WEATHER_WEIGHTS = [0.45, 0.25, 0.15, 0.05, 0.05, 0.05]

def check_huggingface_datasets():
    """Attempt inspecting Hugging Face datasets for reference patterns"""
    hf_sources = [
        "https://huggingface.co/datasets/LaelaZorana/synthetic-ecommerce",
        "https://huggingface.co/datasets/jlh/uci-shopper",
        "https://huggingface.co/datasets/Phoenix21/mock_fraud-detection-dataset"
    ]
    print("Checking Hugging Face dataset references...")
    for url in hf_sources:
        try:
            r = requests.head(url, timeout=3)
            print(f"  HF Reference [{url.split('/')[-1]}]: HTTP {r.status_code}")
        except Exception as e:
            print(f"  HF Reference [{url.split('/')[-1]}]: Offline / Connection skipped ({e.__class__.__name__})")
    print("Proceeding with TicketLedger localized Pakistani synthetic distribution generation.\n")

# -------------------------------------------------------------
# 1. Behavior Sequences (100,000 rows)
# -------------------------------------------------------------
def generate_behavior_sequences(n_rows=100000, seed=42):
    print(f"Generating behavior_sequences.csv ({n_rows:,} rows)...")
    np.random.seed(seed)

    cities = np.random.choice(CITIES, size=n_rows, p=CITY_WEIGHTS)
    event_types = np.random.choice(EVENT_TYPES, size=n_rows, p=EVENT_WEIGHTS)
    
    # Event views: right-skewed distribution
    event_views = np.random.geometric(p=0.25, size=n_rows)
    event_views = np.clip(event_views, 1, 25)

    # Seat selection happens if views > 1 with high probability
    prob_seat = np.clip(0.20 + (event_views * 0.05), 0.10, 0.90)
    seat_selection = np.random.binomial(n=1, p=prob_seat)

    # Checkout started requires seat selection
    prob_checkout = np.where(seat_selection == 1, 0.65, 0.02)
    checkout_started = np.random.binomial(n=1, p=prob_checkout)

    # Checkout abandoned happens mostly when checkout was started
    prob_abandon = np.where(checkout_started == 1, 0.35, 0.0)
    checkout_abandoned = np.random.binomial(n=1, p=prob_abandon)

    # Previous purchases (0 to 15)
    previous_purchases = np.random.poisson(lam=1.8, size=n_rows)
    previous_purchases = np.clip(previous_purchases, 0, 20)

    # Ticket prices (PKR 500 to 25,000)
    base_price = np.random.choice([1000, 2500, 4000, 7500, 15000], size=n_rows, p=[0.40, 0.30, 0.15, 0.10, 0.05])
    noise_price = np.random.normal(loc=0, scale=200, size=n_rows)
    ticket_price = np.clip(np.round((base_price + noise_price) / 100) * 100, 500, 30000).astype(int)

    # Compute ground-truth purchase intent score (0-100) based on realistic behavioral funnel
    # Views (+15), Seat (+25), Checkout Started (+30), Abandoned (-20), Prev Purchases (+15), Price elasticity
    price_penalty = np.where(ticket_price > 10000, 12, np.where(ticket_price > 5000, 6, 0))
    event_boost = np.where(np.isin(event_types, ["CRICKET_MATCH", "MUSIC_CONCERT"]), 8, 2)
    
    raw_intent = (
        (np.clip(event_views, 1, 10) * 2.5) +
        (seat_selection * 24.0) +
        (checkout_started * 32.0) -
        (checkout_abandoned * 18.0) +
        (np.clip(previous_purchases, 0, 5) * 4.0) +
        event_boost -
        price_penalty +
        np.random.normal(0, 4.0, size=n_rows)
    )

    purchase_intent_score = np.clip(np.round(raw_intent), 5, 99).astype(int)

    df = pd.DataFrame({
        "event_views": event_views,
        "seat_selection": seat_selection,
        "checkout_started": checkout_started,
        "checkout_abandoned": checkout_abandoned,
        "ticket_price": ticket_price,
        "city": cities,
        "event_type": event_types,
        "previous_purchases": previous_purchases,
        "purchase_intent_score": purchase_intent_score
    })

    file_path = os.path.join(DATA_DIR, "behavior_sequences.csv")
    df.to_csv(file_path, index=False)
    print(f"  Saved: {file_path} ({len(df):,} rows)")
    return df

# -------------------------------------------------------------
# 2. Fraud Purchases (50,000 rows)
# -------------------------------------------------------------
def generate_fraud_purchases(n_rows=50000, seed=42):
    print(f"Generating fraud_purchases.csv ({n_rows:,} rows)...")
    np.random.seed(seed)

    # ~12% bot/scalper fraud proportion
    is_fraud = np.random.binomial(n=1, p=0.12, size=n_rows)

    # Normal vs Bot features
    # Account age in days: bots are brand new accounts (< 5 days)
    account_age_normal = np.random.exponential(scale=180, size=n_rows).clip(5, 1200)
    account_age_bot = np.random.uniform(0.1, 4.0, size=n_rows)
    account_age_days = np.where(is_fraud == 1, account_age_bot, account_age_normal).round(1)

    # Ticket count: bots max out limits (5-10 tickets)
    ticket_count_normal = np.random.choice([1, 2, 3, 4], size=n_rows, p=[0.35, 0.45, 0.15, 0.05])
    ticket_count_bot = np.random.choice([4, 6, 8, 10], size=n_rows, p=[0.20, 0.30, 0.30, 0.20])
    ticket_count = np.where(is_fraud == 1, ticket_count_bot, ticket_count_normal)

    # Unit ticket price
    unit_price = np.random.choice([1500, 3000, 5000, 9000], size=n_rows, p=[0.30, 0.40, 0.20, 0.10])
    total_amount = (ticket_count * unit_price).astype(int)

    # Failed payment attempts
    failed_normal = np.random.choice([0, 1, 2], size=n_rows, p=[0.85, 0.12, 0.03])
    failed_bot = np.random.choice([0, 1, 2, 3, 5], size=n_rows, p=[0.20, 0.25, 0.25, 0.20, 0.10])
    failed_payments = np.where(is_fraud == 1, failed_bot, failed_normal)

    # Device change count (bots rotate user-agents and headless browsers)
    device_normal = np.random.choice([0, 1], size=n_rows, p=[0.92, 0.08])
    device_bot = np.random.choice([1, 2, 3, 4, 6], size=n_rows, p=[0.15, 0.30, 0.30, 0.15, 0.10])
    device_change_count = np.where(is_fraud == 1, device_bot, device_normal)

    # IP / City mismatch (e.g. data center IP vs Pakistani residential IP)
    mismatch_normal = np.random.binomial(n=1, p=0.06, size=n_rows)
    mismatch_bot = np.random.binomial(n=1, p=0.78, size=n_rows)
    ip_city_mismatch = np.where(is_fraud == 1, mismatch_bot, mismatch_normal)

    # Purchase speed seconds (seat map dwell to checkout button)
    # Humans take 20s to 120s; automated bots complete sub-second (0.3s to 2.5s)
    speed_normal = np.random.normal(loc=45.0, scale=18.0, size=n_rows).clip(8.0, 240.0)
    speed_bot = np.random.exponential(scale=1.2, size=n_rows).clip(0.2, 3.5)
    purchase_speed_seconds = np.where(is_fraud == 1, speed_bot, speed_normal).round(2)

    # Resale attempts (scalper behavior)
    resale_normal = np.random.choice([0, 1], size=n_rows, p=[0.95, 0.05])
    resale_bot = np.random.choice([1, 2, 3, 5], size=n_rows, p=[0.30, 0.35, 0.25, 0.10])
    resale_attempts = np.where(is_fraud == 1, resale_bot, resale_normal)

    # Calibrated ground-truth fraud score (0-100)
    raw_score = (
        (is_fraud * 60.0) +
        (device_change_count * 7.0) +
        (ip_city_mismatch * 15.0) +
        (np.where(purchase_speed_seconds < 2.0, 22.0, 0)) +
        (failed_payments * 4.5) +
        (resale_attempts * 6.0) +
        np.random.normal(0, 3.0, size=n_rows)
    )
    fraud_score = np.clip(np.round(raw_score), 1, 99).astype(int)

    df = pd.DataFrame({
        "account_age_days": account_age_days,
        "ticket_count": ticket_count,
        "total_amount": total_amount,
        "failed_payments": failed_payments,
        "device_change_count": device_change_count,
        "ip_city_mismatch": ip_city_mismatch,
        "purchase_speed_seconds": purchase_speed_seconds,
        "resale_attempts": resale_attempts,
        "fraud_score": fraud_score,
        "is_fraud": is_fraud
    })

    file_path = os.path.join(DATA_DIR, "fraud_purchases.csv")
    df.to_csv(file_path, index=False)
    print(f"  Saved: {file_path} ({len(df):,} rows)")
    return df

# -------------------------------------------------------------
# 3. Event Demand (5,000 rows)
# -------------------------------------------------------------
def generate_event_demand(n_rows=5000, seed=42):
    print(f"Generating event_demand.csv ({n_rows:,} rows)...")
    np.random.seed(seed)

    cities = np.random.choice(CITIES, size=n_rows, p=CITY_WEIGHTS)
    event_types = np.random.choice(EVENT_TYPES, size=n_rows, p=EVENT_WEIGHTS)
    days_of_week = np.random.choice(DAYS_OF_WEEK, size=n_rows, p=DAY_WEIGHTS)
    publish_hour = np.random.randint(9, 23, size=n_rows) # 9 AM to 11 PM

    # Venue capacity: stadiums (20k-40k), auditoriums (2k-6k), arenas (8k-18k)
    capacity_by_type = {
        "CRICKET_MATCH": (18000, 38000),
        "FOOTBALL_MATCH": (8000, 22000),
        "KABADDI": (6000, 16000),
        "BOXING": (3000, 10000),
        "MUSIC_CONCERT": (4000, 25000),
        "MUSIC_FESTIVAL": (8000, 30000),
    }

    venue_capacity = np.array([
        np.random.randint(capacity_by_type[et][0], capacity_by_type[et][1])
        for et in event_types
    ])

    # Average ticket prices in PKR
    price_by_type = {
        "CRICKET_MATCH": (1200, 4500),
        "FOOTBALL_MATCH": (800, 2500),
        "KABADDI": (500, 1800),
        "BOXING": (1500, 5000),
        "MUSIC_CONCERT": (2500, 8500),
        "MUSIC_FESTIVAL": (3500, 12000),
    }

    ticket_prices = np.array([
        np.random.uniform(price_by_type[et][0], price_by_type[et][1])
        for et in event_types
    ]).round(-2) # rounded to nearest 100

    popularity_score = np.random.uniform(35.0, 99.0, size=n_rows).round(1)
    marketing_score = np.random.uniform(20.0, 98.0, size=n_rows).round(1)

    # Compute 48-hour sales ratio based on capacity, popularity, weekend, and pricing
    is_weekend = np.isin(days_of_week, ["Friday", "Saturday", "Sunday"]).astype(float)
    type_factor = np.where(event_types == "CRICKET_MATCH", 1.25, np.where(event_types == "MUSIC_CONCERT", 1.15, 0.95))

    demand_index = (
        (popularity_score * 0.45) +
        (marketing_score * 0.30) +
        (is_weekend * 12.0) +
        (type_factor * 10.0) -
        (ticket_prices / 1200.0)
    )

    # Convert demand index into sales percentage (15% to 98% of capacity)
    sales_ratio = np.clip(demand_index / 120.0, 0.15, 0.98)
    predicted_48h_sales = (venue_capacity * sales_ratio).round().astype(int)
    expected_revenue_pkr = (predicted_48h_sales * ticket_prices).round().astype(float)

    # Demand level classification
    demand_level = np.where(
        sales_ratio >= 0.80, "VERY_HIGH",
        np.where(sales_ratio >= 0.55, "HIGH",
        np.where(sales_ratio >= 0.35, "MEDIUM", "LOW"))
    )

    df = pd.DataFrame({
        "event_type": event_types,
        "city": cities,
        "venue_capacity": venue_capacity,
        "ticket_prices": ticket_prices,
        "day_of_week": days_of_week,
        "publish_hour": publish_hour,
        "popularity_score": popularity_score,
        "marketing_score": marketing_score,
        "predicted_48h_sales": predicted_48h_sales,
        "expected_revenue_pkr": expected_revenue_pkr,
        "demand_level": demand_level
    })

    file_path = os.path.join(DATA_DIR, "event_demand.csv")
    df.to_csv(file_path, index=False)
    print(f"  Saved: {file_path} ({len(df):,} rows)")
    return df

# -------------------------------------------------------------
# 4. Attendance No-Show (50,000 rows)
# -------------------------------------------------------------
def generate_attendance_no_show(n_rows=50000, seed=42):
    print(f"Generating attendance_no_show.csv ({n_rows:,} rows)...")
    np.random.seed(seed)

    event_types = np.random.choice(EVENT_TYPES, size=n_rows, p=EVENT_WEIGHTS)
    cities = np.random.choice(CITIES, size=n_rows, p=CITY_WEIGHTS)
    ticket_tiers = np.random.choice(TIERS, size=n_rows, p=TIER_WEIGHTS)
    day_of_week = np.random.choice(DAYS_OF_WEEK, size=n_rows, p=DAY_WEIGHTS)
    weather_condition = np.random.choice(WEATHER_CONDITIONS, size=n_rows, p=WEATHER_WEIGHTS)

    ticket_price = np.random.choice([800, 1500, 3000, 6000, 12000], size=n_rows, p=[0.35, 0.30, 0.20, 0.10, 0.05])
    distance_km = np.random.exponential(scale=14.0, size=n_rows).clip(0.5, 95.0).round(1)
    is_resold = np.random.binomial(n=1, p=0.08, size=n_rows)
    days_before_purchased = np.random.randint(1, 35, size=n_rows)

    # Calculate check-in probability
    # Higher ticket price = lower no-show (attendee invested more)
    # Bad weather (rain/extreme heat) = higher no-show
    # Far distance = higher no-show
    # Resold tickets = high attendance (active buyers)
    weather_penalty = np.where(np.isin(weather_condition, ["Rainy", "Extreme Heat"]), 0.20, 0.02)
    distance_penalty = np.clip(distance_km / 120.0, 0.0, 0.25)
    price_bonus = np.clip(ticket_price / 15000.0, 0.05, 0.20)
    resold_bonus = is_resold * 0.10

    base_checkin_prob = 0.88 - weather_penalty - distance_penalty + price_bonus + resold_bonus
    checkin_prob = np.clip(base_checkin_prob, 0.20, 0.99)
    checked_in = np.random.binomial(n=1, p=checkin_prob)

    no_show_risk = np.clip(np.round((1.0 - checkin_prob) * 100), 1, 99).astype(int)

    df = pd.DataFrame({
        "event_type": event_types,
        "city": cities,
        "ticket_tier": ticket_tiers,
        "ticket_price": ticket_price,
        "day_of_week": day_of_week,
        "weather_condition": weather_condition,
        "distance_km": distance_km,
        "is_resold": is_resold,
        "days_before_event_purchased": days_before_purchased,
        "checked_in": checked_in,
        "no_show_risk": no_show_risk
    })

    file_path = os.path.join(DATA_DIR, "attendance_no_show.csv")
    df.to_csv(file_path, index=False)
    print(f"  Saved: {file_path} ({len(df):,} rows)")
    return df

def main():
    start_time = time.time()
    print("=" * 65)
    print("TicketLedger - Module 14: ML Synthetic Dataset Generator")
    print("=" * 65)
    check_huggingface_datasets()

    generate_behavior_sequences(100000)
    generate_fraud_purchases(50000)
    generate_event_demand(5000)
    generate_attendance_no_show(50000)

    elapsed = time.time() - start_time
    print(f"\nSuccessfully generated all 4 datasets (205,000 total rows) in {elapsed:.2f}s!")
    print(f"Datasets located in: {DATA_DIR}")

if __name__ == "__main__":
    main()
