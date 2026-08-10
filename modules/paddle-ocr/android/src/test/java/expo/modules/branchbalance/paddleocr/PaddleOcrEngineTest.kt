package expo.modules.branchbalance.paddleocr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.opencv.core.Point
import kotlin.math.abs

class PaddleOcrEngineTest {
  @Test
  fun `orders a diamond without duplicating tied corners`() {
    val ordered = orderQuadrilateralPoints(listOf(
      Point(0.0, 10.0),
      Point(10.0, 0.0),
      Point(20.0, 10.0),
      Point(10.0, 20.0),
    ))

    assertEquals(4, ordered.map { it.x to it.y }.toSet().size)
    assertTrue(abs(ordered.indices.sumOf { index ->
      val point = ordered[index]
      val next = ordered[(index + 1) % ordered.size]
      point.x * next.y - next.x * point.y
    }) >= 2.0)
  }
}
