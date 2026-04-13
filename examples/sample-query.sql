SELECT
  o.user_id,
  SUM(o.revenue) / COUNT(o.order_id) AS avg_order_value
FROM orders o
GROUP BY o.user_id;
