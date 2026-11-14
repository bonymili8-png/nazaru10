-- House horses now follow their class's entry rules (rating band; maidens never won), as players
-- do. Bring the existing pools in line, using the default bands:
-- 1. House horses drawn for a higher class all started on 1000: lift them to their band's floor.
UPDATE horses
   SET race_rating = CASE house_class WHEN 'CLASS_4' THEN 1100 WHEN 'CLASS_3' THEN 1200
                                      WHEN 'CLASS_2' THEN 1300 WHEN 'CLASS_1' THEN 1400 END
 WHERE is_house AND owner_id IS NULL
   AND ((house_class = 'CLASS_4' AND race_rating < 1100) OR (house_class = 'CLASS_3' AND race_rating < 1200)
     OR (house_class = 'CLASS_2' AND race_rating < 1300) OR (house_class = 'CLASS_1' AND race_rating < 1400));

-- 2. Those that outgrew their class (rated above its band, or a maiden pool horse that has won)
--    move to the class their rating fits.
UPDATE horses
   SET house_class = CASE WHEN race_rating >= 1400 THEN 'CLASS_1' WHEN race_rating >= 1300 THEN 'CLASS_2'
                          WHEN race_rating >= 1200 THEN 'CLASS_3' WHEN race_rating >= 1100 THEN 'CLASS_4'
                          ELSE 'CLASS_5' END
 WHERE is_house AND owner_id IS NULL
   AND ((house_class = 'MAIDEN' AND wins > 0)
     OR (house_class = 'CLASS_5' AND race_rating > 1099) OR (house_class = 'CLASS_4' AND race_rating > 1199)
     OR (house_class = 'CLASS_3' AND race_rating > 1299) OR (house_class = 'CLASS_2' AND race_rating > 1399));
