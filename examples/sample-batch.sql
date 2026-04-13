-- Query 1: Orders by user
SELECT
  user_id,
  COUNT(order_id) AS order_count
FROM orders
GROUP BY user_id;

-- Query 2: Potential join-risk pattern
SELECT
  o.user_id,
  o.order_id,
  p.payment_id
FROM orders o
JOIN payments p
  ON o.user_id = p.user_id;
