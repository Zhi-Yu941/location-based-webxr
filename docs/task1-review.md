#Task 1 review
11.07.2026:
    Notes: first gaussian splat rendering of the 2 provided zip files (electromobil station)

    1. Training result:
        (2026-07-09_15-47-48utc)
        final error: 0.0282 (mathematically very low)
        We started the review from the second training result because it was significantly worse in quality. Therefore, I advise to read the second one first.
        Problems appeared: ghosted/smeared/doubled appear
            1. Photo 5:
            Note: Now this becomes interesting. For this render we had a several cameras with provided images. The picture still remains blurry and ghosting from some angles. Now we can suspect that there might be a technical issue when trying to merge all the views.
            Cause: We suspect a technical issue with coordinates/angles here.
            Screenshot: [photo 5](./assets/images/task1-5.jpeg)
            How to solve: not yet decided

            2. Photo 6:
            Note: In this picture we see a render from the front made out of a single picture that had good quality. This, to some extend, proves our theory from Photo 5, although the render still isn't clear enough. We will try to explore this in the future.
            Cause: ???
            Screenshot: [photo 6](./assets/images/task1-6.jpeg)
            How to solve: ???

            2. Photo 7:
            Note: We did spot visible ghosting from the side and a lot of noise around the edges. The cable looks also doubled in some places. We also get a lot of floating splats around the object.
            Cause: It was probably caused by a bad overlap of images. A more detailed and consistent capture should do the job.
            Screenshot: [photo 7](./assets/images/task1-7.jpeg)
            How to solve: Consistent capture

        Note: Stable, thick objects recorded are clearly visible and also represent the real-life shape, however it seems to be the best only if we do a photo for every circa 15 degrees. There were also inconsistencies regarding the total height of the photos, top of the charging station was distorted from some angles. This should be taken into consideration when recording the splats via phone, not a technical issue afaik. 

    2. Training result:
        (2026-07-09_15-46-36utc)
        final error: 0.0434
        Problems appeared: ghosted/smeared/doubled appear
            1. Photo 1:
            Note: Good render from the front. Main object is visible and the charging station shape is understandable. Still some noisines especially around the object. The ground is rendered alright - floating splats.
            Cause: This angle had better coverage - object was wisible throughout cirka 6 photos. The surrounding noise is probably from bad poses, reflections or vegetation. Lightning could have also been an issue.
            Screenshot: [photo 1](./assets/images/task1-1.jpeg)
            How to solve: More stable circle around the object moving with slower movement. Definitelly a stable pivot on the y-axis during capture, so the background becomes less noisy.

            2. Photo 2:
            Note: Basically photo 1 from the side. The main station is still visible, but the pipes/cables are ghosted and partialy floating. Small, thin floating objects like pipes seem to be a problem - ghosting/doubled.
            Cause: Thin objects are harder to render out and probably did not have enough various views. Could also be pose inconsistency from this side.
            Screenshot: [photo 2](./assets/images/task1-2.jpeg)
            How to solve: More side photos, especially when trying to capture smaller 3d objects with unusual geometry.

            3. Photo 3:
            Note: Orange station/object is rendered quite good, but the text isn't readable - smearing/ghosting in the middle and around the text.
            Cause: Text is a small detail and probably gets lost easily? 
            Screenshot: [photo 3](./assets/images/task1-3.jpeg)
            How to solve: More close but stable photos of the text side. In this case maybe a circular capture, would render the text better. The frame consistency should be the main priority.

            4. Photo 4:
            Note: The main powerstation frame is mostly visible, but there is a clear issue with the surrounding left side. Almost the entire part is smeared and blured out. Could be a technical issue where the coordinates didn't quite fit right because it just looks weird.
            Cause: Probably weaker coverage from this angle or bad alignment between views?? The side/background seems to confuse the entire render.
            Screenshot: [photo 4](./assets/images/task1-4.jpeg)
            How to solve: Capture in full circle more evenly, with the same height...

        Note: Worse than the first one. (The size of this zip is also smaller)

        Guess: the frame rate of the record is too low. There is probably not enough overlap between the photos and this causes ghosting/smearing/doubling, especially for small objects like pipes, cables, text and thin frames.

    Progress:
    Task 1 kind of finished. Both toolchain smoke-tests succeed.

    Questions:
    1. In images.txt the images begin to be quoted since the second one. WHY???
    2. How does the TRACK[](feature tracks) in points3D.txt work? Why there is no feature tracks?
    3. What exactly does the mathematical error mean in correlation to quality of the rendered splat?
    4. Can the final error be low even if the splat visually has ghosting/smearing/doubling?

Task STATUS: waiting for review
Ligtworkstudio version used: v0.4.2
Other notes:
    This dataset is useful for Task 2 because the pipeline works and the object is recognizable, but there are still visible issue. My doubt(Filip): we mainly described the "good manners" of the capture process in order to get a better splat in the end. I do not really know what the technical improvement for the part 2 might be.
